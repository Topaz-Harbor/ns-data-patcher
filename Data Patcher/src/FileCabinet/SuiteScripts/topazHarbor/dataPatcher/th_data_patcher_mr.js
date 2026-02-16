/**
 * Data Patcher Map/Reduce Script
 * Runs a parameterized SuiteQL query and applies header-field updates for each result row.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @author Stephen Lemp <stephen@topazharbor.com>
 * @license MIT
 */
define(['N/cache', 'N/log', 'N/query', 'N/record', 'N/runtime'], (cache, log, query, record, runtime) => {
  const DEFAULT_ALIAS_PREFIX = 'fieldid_';
  const DEFAULT_PAGE_SIZE = 100;
  const MAX_PAGE_SIZE = 1000;
  const CACHE_NAME = 'th_data_patcher_meta';
  const CACHE_TTL_SECONDS = 7200;

  const PARAMS = {
    suiteql: 'custscript_th_dp_suiteql',
    forceLoadSave: 'custscript_th_dp_force_loadsave',
    dryRun: 'custscript_th_dp_dry_run',
    stopOnError: 'custscript_th_dp_stop_on_error',
    maxRows: 'custscript_th_dp_max_rows',
    pageSize: 'custscript_th_dp_page_size',
    aliasPrefix: 'custscript_th_dp_alias_prefix',
    customScriptId: 'custscript_th_dp_custom_script_id'
  };

  const toBoolean = (value) => value === true || value === 'T' || value === 'true' || value === '1';

  const toIntegerOrNull = (value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const normalizePageSize = (pageSize) => {
    if (!pageSize || pageSize < 5) {
      return DEFAULT_PAGE_SIZE;
    }
    return Math.min(pageSize, MAX_PAGE_SIZE);
  };

  const readConfig = () => {
    const script = runtime.getCurrentScript();
    const suiteql = script.getParameter({ name: PARAMS.suiteql });
    const customScriptIdRaw = script.getParameter({ name: PARAMS.customScriptId });

    return {
      suiteql: suiteql ? suiteql.toString().trim() : '',
      forceLoadSave: toBoolean(script.getParameter({ name: PARAMS.forceLoadSave })),
      dryRun: toBoolean(script.getParameter({ name: PARAMS.dryRun })),
      stopOnError: toBoolean(script.getParameter({ name: PARAMS.stopOnError })),
      maxRows: toIntegerOrNull(script.getParameter({ name: PARAMS.maxRows })),
      pageSize: normalizePageSize(toIntegerOrNull(script.getParameter({ name: PARAMS.pageSize }))),
      aliasPrefix: (script.getParameter({ name: PARAMS.aliasPrefix }) || DEFAULT_ALIAS_PREFIX).toString(),
      customScriptId: customScriptIdRaw ? customScriptIdRaw.toString().trim() : ''
    };
  };

  const getMetaCache = () => cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PRIVATE });

  const getCacheKey = () => {
    const script = runtime.getCurrentScript();
    return `${script.id || 'customscript_th_data_patcher'}::${script.deploymentId || 'customdeploy_th_data_patcher_default'}::columns`;
  };

  const buildInputQuery = (config) => {
    if (!config.maxRows || config.maxRows <= 0) {
      return config.suiteql;
    }

    return `SELECT * FROM (${config.suiteql}) thdp_input WHERE ROWNUM <= ${config.maxRows}`;
  };

  const inferColumnNames = (inputQuery, customScriptId) => {
    const probeQuery = `SELECT * FROM (${inputQuery}) thdp_probe WHERE ROWNUM <= 1`;
    const resultSet = query.runSuiteQL({
      query: probeQuery,
      customScriptId: customScriptId || undefined
    });
    const mappedRows = resultSet.asMappedResults();

    if (!mappedRows.length) {
      return [];
    }

    return Object.keys(mappedRows[0]).map((columnName) => columnName.toLowerCase());
  };

  const saveColumnMetadata = (config, inputQuery, columnNames) => {
    const payload = {
      suiteql: config.suiteql,
      inputQuery,
      aliasPrefix: config.aliasPrefix.toLowerCase(),
      columnNames,
      savedAt: new Date().toISOString()
    };

    getMetaCache().put({
      key: getCacheKey(),
      value: JSON.stringify(payload),
      ttl: CACHE_TTL_SECONDS
    });
  };

  const loadColumnMetadata = (config, inputQuery) => {
    const raw = getMetaCache().get({ key: getCacheKey() });
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      if (parsed.suiteql !== config.suiteql || parsed.inputQuery !== inputQuery) {
        return null;
      }
      if (!Array.isArray(parsed.columnNames)) {
        return null;
      }
      return parsed.columnNames;
    } catch (error) {
      log.error({ title: 'Invalid cache payload', details: error.message });
      return null;
    }
  };

  const ensureColumnNames = (config, inputQuery) => {
    const cached = loadColumnMetadata(config, inputQuery);
    if (cached && cached.length) {
      return cached;
    }

    const inferred = inferColumnNames(inputQuery, config.customScriptId);
    saveColumnMetadata(config, inputQuery, inferred);
    return inferred;
  };

  const materializeRow = (columnNames, valuesArray) => {
    const row = {};
    for (let index = 0; index < columnNames.length; index += 1) {
      row[columnNames[index]] = valuesArray[index];
    }
    return row;
  };

  const buildUpdateValues = (row, aliasPrefix) => {
    const updates = {};
    const prefix = aliasPrefix.toLowerCase();

    Object.keys(row).forEach((key) => {
      if (!key.startsWith(prefix)) {
        return;
      }
      const fieldId = key.slice(prefix.length);
      if (!fieldId) {
        return;
      }
      updates[fieldId] = row[key];
    });

    return updates;
  };

  const applyBySubmitFields = (recordType, recordId, values) => {
    record.submitFields({
      type: recordType,
      id: recordId,
      values,
      options: {
        enableSourcing: false,
        ignoreMandatoryFields: true
      }
    });
  };

  const applyByLoadSave = (recordType, recordId, values) => {
    const loadedRecord = record.load({
      type: recordType,
      id: recordId,
      isDynamic: false
    });

    Object.keys(values).forEach((fieldId) => {
      loadedRecord.setValue({
        fieldId,
        value: values[fieldId]
      });
    });

    loadedRecord.save({
      enableSourcing: false,
      ignoreMandatoryFields: true
    });
  };

  const getInputData = () => {
    const config = readConfig();

    if (!config.suiteql) {
      throw Error('Missing required SuiteQL parameter: custscript_th_dp_suiteql');
    }

    const inputQuery = buildInputQuery(config);
    const columnNames = inferColumnNames(inputQuery, config.customScriptId);
    saveColumnMetadata(config, inputQuery, columnNames);

    log.audit({
      title: 'Data patch input configured',
      details: {
        mode: config.forceLoadSave ? 'load-save' : 'submit-fields',
        dryRun: config.dryRun,
        aliasPrefix: config.aliasPrefix,
        maxRows: config.maxRows,
        pageSize: config.pageSize,
        inferredColumns: columnNames
      }
    });

    return {
      type: 'suiteql',
      query: inputQuery
    };
  };

  const map = (context) => {
    const config = readConfig();
    const inputQuery = buildInputQuery(config);
    const columnNames = ensureColumnNames(config, inputQuery);
    const parsed = JSON.parse(context.value);
    const valuesArray = Array.isArray(parsed.values) ? parsed.values : [];

    if (!columnNames.length || columnNames.length < valuesArray.length) {
      throw Error('Unable to resolve SuiteQL column names for map processing.');
    }

    const row = materializeRow(columnNames, valuesArray);
    const recordType = row.recordtype;
    const recordId = row.recordid;

    if (!recordType || !recordId) {
      log.error({
        title: 'Skipped row: required columns missing',
        details: { row }
      });
      context.write({ key: 'skipped', value: '1' });
      return;
    }

    const updateValues = buildUpdateValues(row, config.aliasPrefix);
    const fieldIds = Object.keys(updateValues);

    if (!fieldIds.length) {
      log.audit({
        title: 'Skipped row: no update aliases found',
        details: { recordType, recordId, aliasPrefix: config.aliasPrefix }
      });
      context.write({ key: 'skipped', value: '1' });
      return;
    }

    if (config.dryRun) {
      log.audit({
        title: 'Dry run patch preview',
        details: {
          recordType,
          recordId,
          values: updateValues
        }
      });
      context.write({ key: 'previewed', value: '1' });
      return;
    }

    try {
      if (config.forceLoadSave) {
        applyByLoadSave(recordType, recordId, updateValues);
      } else {
        applyBySubmitFields(recordType, recordId, updateValues);
      }

      log.audit({
        title: 'Patched record',
        details: {
          recordType,
          recordId,
          mode: config.forceLoadSave ? 'load-save' : 'submit-fields',
          fieldIds
        }
      });
      context.write({ key: 'patched', value: '1' });
    } catch (error) {
      log.error({
        title: 'Patch failure',
        details: {
          recordType,
          recordId,
          fieldIds,
          errorName: error.name,
          errorMessage: error.message
        }
      });
      context.write({ key: 'failed', value: '1' });
      if (config.stopOnError) {
        throw error;
      }
    }
  };

  const reduce = (context) => {
    let total = 0;
    context.values.forEach((value) => {
      total += parseInt(value, 10) || 0;
    });
    context.write({ key: context.key, value: String(total) });
  };

  const summarize = (summary) => {
    const totals = {
      patched: 0,
      previewed: 0,
      failed: 0,
      skipped: 0,
      inputErrors: 0,
      mapErrors: 0,
      reduceErrors: 0
    };

    summary.output.iterator().each((key, value) => {
      totals[key] = parseInt(value, 10) || 0;
      return true;
    });

    summary.inputSummary.errors.iterator().each((key, error) => {
      totals.inputErrors += 1;
      log.error({ title: `Input error for key ${key}`, details: error });
      return true;
    });

    summary.mapSummary.errors.iterator().each((key, error) => {
      totals.mapErrors += 1;
      log.error({ title: `Map error for key ${key}`, details: error });
      return true;
    });

    summary.reduceSummary.errors.iterator().each((key, error) => {
      totals.reduceErrors += 1;
      log.error({ title: `Reduce error for key ${key}`, details: error });
      return true;
    });

    log.audit({
      title: 'Data patch run summary',
      details: totals
    });
  };

  return {
    getInputData,
    map,
    reduce,
    summarize
  };
});
