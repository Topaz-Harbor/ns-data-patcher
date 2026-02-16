/**
 * Data Patcher Map/Reduce Script
 * Runs a parameterized SuiteQL query and applies body/sublist updates for each result row.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @author Stephen Lemp <stephen@topazharbor.com>
 * @license MIT
 */
define(['N/cache', 'N/log', 'N/query', 'N/record', 'N/runtime'], (cache, log, query, record, runtime) => {
  const DEFAULT_ALIAS_PREFIX = 'fieldid_';
  const DEFAULT_LINE_ALIAS_PREFIX = 'linefield_';
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
      lineAliasPrefix: DEFAULT_LINE_ALIAS_PREFIX,
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

  const buildAliasValues = (row, prefix) => {
    const updates = {};
    const normalizedPrefix = prefix.toLowerCase();

    Object.keys(row).forEach((key) => {
      if (!key.startsWith(normalizedPrefix)) {
        return;
      }
      const fieldId = key.slice(normalizedPrefix.length);
      if (!fieldId) {
        return;
      }
      updates[fieldId] = row[key];
    });

    return updates;
  };

  const getLineLocator = (row) => ({
    sublistId: row.sublistid ? row.sublistid.toString() : '',
    lineUniqueKey: row.lineuniquekey === undefined || row.lineuniquekey === null ? '' : row.lineuniquekey.toString(),
    lineNumber: toIntegerOrNull(row.linenumber),
    lineIndex: toIntegerOrNull(row.lineindex)
  });

  const resolveLineIndex = (loadedRecord, locator) => {
    const lineCount = loadedRecord.getLineCount({ sublistId: locator.sublistId });

    if (locator.lineIndex !== null) {
      if (locator.lineIndex < 0 || locator.lineIndex >= lineCount) {
        throw Error(`Line index ${locator.lineIndex} is out of range for sublist ${locator.sublistId}.`);
      }
      return locator.lineIndex;
    }

    if (locator.lineNumber !== null) {
      const zeroBased = locator.lineNumber - 1;
      if (zeroBased < 0 || zeroBased >= lineCount) {
        throw Error(`Line number ${locator.lineNumber} is out of range for sublist ${locator.sublistId}.`);
      }
      return zeroBased;
    }

    if (locator.lineUniqueKey) {
      for (let index = 0; index < lineCount; index += 1) {
        const value = loadedRecord.getSublistValue({
          sublistId: locator.sublistId,
          fieldId: 'lineuniquekey',
          line: index
        });
        if (value !== undefined && value !== null && value.toString() === locator.lineUniqueKey) {
          return index;
        }
      }
      throw Error(`No line matched lineuniquekey ${locator.lineUniqueKey} on sublist ${locator.sublistId}.`);
    }

    throw Error('Sublist updates require lineindex, linenumber, or lineuniquekey.');
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

  const applySublistUpdate = (recordType, recordId, row, bodyValues, lineValues) => {
    const locator = getLineLocator(row);
    if (!locator.sublistId) {
      throw Error('Sublist updates require sublistid column.');
    }

    const loadedRecord = record.load({
      type: recordType,
      id: recordId,
      isDynamic: false
    });

    Object.keys(bodyValues).forEach((fieldId) => {
      loadedRecord.setValue({
        fieldId,
        value: bodyValues[fieldId]
      });
    });

    const lineIndex = resolveLineIndex(loadedRecord, locator);
    Object.keys(lineValues).forEach((fieldId) => {
      loadedRecord.setSublistValue({
        sublistId: locator.sublistId,
        fieldId,
        line: lineIndex,
        value: lineValues[fieldId]
      });
    });

    loadedRecord.save({
      enableSourcing: false,
      ignoreMandatoryFields: true
    });

    return {
      sublistId: locator.sublistId,
      lineIndex
    };
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
        mode: config.forceLoadSave ? 'load-save' : 'inline-edit',
        dryRun: config.dryRun,
        aliasPrefix: config.aliasPrefix,
        lineAliasPrefix: DEFAULT_LINE_ALIAS_PREFIX,
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

    const bodyValues = buildAliasValues(row, config.aliasPrefix);
    const lineValues = buildAliasValues(row, DEFAULT_LINE_ALIAS_PREFIX);
    const bodyFieldIds = Object.keys(bodyValues);
    const lineFieldIds = Object.keys(lineValues);

    if (!bodyFieldIds.length && !lineFieldIds.length) {
      log.audit({
        title: 'Skipped row: no update aliases found',
        details: { recordType, recordId, aliasPrefix: config.aliasPrefix, lineAliasPrefix: DEFAULT_LINE_ALIAS_PREFIX }
      });
      context.write({ key: 'skipped', value: '1' });
      return;
    }

    const effectiveMode = lineFieldIds.length ? 'sublist-load-save' : (config.forceLoadSave ? 'load-save' : 'inline-edit');

    if (config.dryRun) {
      log.audit({
        title: 'Dry run patch preview',
        details: {
          recordType,
          recordId,
          mode: effectiveMode,
          bodyValues,
          lineValues,
          sublistId: row.sublistid || ''
        }
      });
      context.write({ key: 'previewed', value: '1' });
      return;
    }

    try {
      let sublistResult = null;
      if (lineFieldIds.length) {
        sublistResult = applySublistUpdate(recordType, recordId, row, bodyValues, lineValues);
      } else if (config.forceLoadSave) {
        applyByLoadSave(recordType, recordId, bodyValues);
      } else {
        applyBySubmitFields(recordType, recordId, bodyValues);
      }

      log.audit({
        title: 'Patched record',
        details: {
          recordType,
          recordId,
          mode: effectiveMode,
          bodyFieldIds,
          lineFieldIds,
          sublistId: sublistResult ? sublistResult.sublistId : '',
          lineIndex: sublistResult ? sublistResult.lineIndex : ''
        }
      });
      context.write({ key: 'patched', value: '1' });
    } catch (error) {
      log.error({
        title: 'Patch failure',
        details: {
          recordType,
          recordId,
          mode: effectiveMode,
          bodyFieldIds,
          lineFieldIds,
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

    const iterate = (iteratorHolder, callback) => {
      if (!iteratorHolder || typeof iteratorHolder.iterator !== 'function') {
        return;
      }
      iteratorHolder.iterator().each((key, value) => callback(key, value));
    };

    iterate(summary.output, (key, value) => {
      totals[key] = parseInt(value, 10) || 0;
      return true;
    });

    iterate(summary.inputSummary && summary.inputSummary.errors, (key, error) => {
      totals.inputErrors += 1;
      log.error({ title: `Input error for key ${key}`, details: error });
      return true;
    });

    iterate(summary.mapSummary && summary.mapSummary.errors, (key, error) => {
      totals.mapErrors += 1;
      log.error({ title: `Map error for key ${key}`, details: error });
      return true;
    });

    iterate(summary.reduceSummary && summary.reduceSummary.errors, (key, error) => {
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
