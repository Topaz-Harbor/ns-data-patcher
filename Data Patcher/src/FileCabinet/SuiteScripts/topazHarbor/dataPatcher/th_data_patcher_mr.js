/**
 * Data Patcher Map/Reduce Script
 * Runs a parameterized SuiteQL query and applies header-field updates for each result row.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @author Stephen Lemp <stephen@topazharbor.com>
 * @license MIT
 */
define(['N/log', 'N/query', 'N/record', 'N/runtime'], (log, query, record, runtime) => {
  const DEFAULT_ALIAS_PREFIX = 'fieldid_';
  const DEFAULT_PAGE_SIZE = 100;
  const MAX_PAGE_SIZE = 1000;

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

  const normalizeRow = (row) => {
    const normalized = {};
    Object.keys(row).forEach((key) => {
      normalized[key.toLowerCase()] = row[key];
    });
    return normalized;
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

    const inputRows = [];
    const skipped = {
      missingRecordColumns: 0,
      noUpdateAliases: 0
    };

    const pagedQuery = query.runSuiteQLPaged({
      query: config.suiteql,
      pageSize: config.pageSize,
      customScriptId: config.customScriptId || undefined
    });

    for (let pageIndex = 0; pageIndex < pagedQuery.pageRanges.length; pageIndex += 1) {
      if (config.maxRows && inputRows.length >= config.maxRows) {
        break;
      }

      const page = pagedQuery.fetch({ index: pageIndex });
      const rows = page.data.asMappedResults();

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        if (config.maxRows && inputRows.length >= config.maxRows) {
          break;
        }

        const rawRow = rows[rowIndex];
        const row = normalizeRow(rawRow);
        const recordType = row.recordtype;
        const recordId = row.recordid;

        if (!recordType || !recordId) {
          skipped.missingRecordColumns += 1;
          log.error({
            title: 'Skipped row: required columns missing',
            details: { row: rawRow }
          });
          continue;
        }

        const values = buildUpdateValues(row, config.aliasPrefix);
        if (!Object.keys(values).length) {
          skipped.noUpdateAliases += 1;
          log.audit({
            title: 'Skipped row: no update aliases found',
            details: { recordType, recordId, aliasPrefix: config.aliasPrefix }
          });
          continue;
        }

        inputRows.push({
          recordType,
          recordId,
          values
        });
      }
    }

    log.audit({
      title: 'Data patch input summary',
      details: {
        stagedRows: inputRows.length,
        skipped,
        mode: config.forceLoadSave ? 'load-save' : 'submit-fields',
        dryRun: config.dryRun,
        aliasPrefix: config.aliasPrefix,
        maxRows: config.maxRows,
        pageSize: config.pageSize
      }
    });

    return inputRows;
  };

  const map = (context) => {
    const config = readConfig();
    const input = JSON.parse(context.value);

    if (config.dryRun) {
      log.audit({
        title: 'Dry run patch preview',
        details: {
          recordType: input.recordType,
          recordId: input.recordId,
          values: input.values
        }
      });
      context.write({ key: 'previewed', value: '1' });
      return;
    }

    try {
      if (config.forceLoadSave) {
        applyByLoadSave(input.recordType, input.recordId, input.values);
      } else {
        applyBySubmitFields(input.recordType, input.recordId, input.values);
      }

      log.audit({
        title: 'Patched record',
        details: {
          recordType: input.recordType,
          recordId: input.recordId,
          mode: config.forceLoadSave ? 'load-save' : 'submit-fields',
          fieldIds: Object.keys(input.values)
        }
      });
      context.write({ key: 'patched', value: '1' });
    } catch (error) {
      log.error({
        title: 'Patch failure',
        details: {
          recordType: input.recordType,
          recordId: input.recordId,
          fieldIds: Object.keys(input.values),
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
