/**
 * Data Patcher Map/Reduce Script
 * Runs a parameterized SuiteQL query and applies update/create/delete actions.
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @author Stephen Lemp <stephen@topazharbor.com>
 * @license MIT
 */
define(['N/cache', 'N/log', 'N/query', 'N/record', 'N/runtime'], (cache, log, query, record, runtime) => {
  const DEFAULT_ALIAS_PREFIX = 'fieldid_';
  const DEFAULT_LINE_ALIAS_PREFIX = 'linefield_';
  const DEFAULT_ACTION = 'update';
  const META_CACHE_NAME = 'th_data_patcher_meta';
  const ABORT_CACHE_NAME = 'th_data_patcher_abort';
  const CACHE_TTL_SECONDS = 7200;

  const PARAMS = {
    suiteql: 'custscript_th_dp_suiteql',
    forceLoadSave: 'custscript_th_dp_force_loadsave',
    dryRun: 'custscript_th_dp_dry_run',
    stopOnError: 'custscript_th_dp_stop_on_error',
    maxRows: 'custscript_th_dp_max_rows',
    aliasPrefix: 'custscript_th_dp_alias_prefix',
    customScriptId: 'custscript_th_dp_custom_script_id',
    enableActions: 'custscript_th_dp_enable_actions'
  };

  const toBoolean = (value) => value === true || value === 'T' || value === 'true' || value === '1';

  const toIntegerOrNull = (value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const getScriptIdentity = () => {
    const script = runtime.getCurrentScript();
    return {
      scriptId: script.id || 'customscript_th_data_patcher',
      deploymentId: script.deploymentId || 'customdeploy_th_data_patcher_default'
    };
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
      aliasPrefix: (script.getParameter({ name: PARAMS.aliasPrefix }) || DEFAULT_ALIAS_PREFIX).toString(),
      customScriptId: customScriptIdRaw ? customScriptIdRaw.toString().trim() : '',
      enableActions: toBoolean(script.getParameter({ name: PARAMS.enableActions }))
    };
  };

  const getMetaCache = () => cache.getCache({ name: META_CACHE_NAME, scope: cache.Scope.PRIVATE });
  const getAbortCache = () => cache.getCache({ name: ABORT_CACHE_NAME, scope: cache.Scope.PRIVATE });

  const getMetaCacheKey = () => {
    const identity = getScriptIdentity();
    return `${identity.scriptId}::${identity.deploymentId}::columns`;
  };

  const getAbortCacheKey = () => {
    const identity = getScriptIdentity();
    return `${identity.scriptId}::${identity.deploymentId}::abort`;
  };

  const clearAbortFlag = () => {
    const abortCache = getAbortCache();
    const key = getAbortCacheKey();
    try {
      abortCache.remove({ key });
    } catch (error) {
      abortCache.put({ key, value: 'F', ttl: CACHE_TTL_SECONDS });
    }
  };

  const setAbortFlag = (details) => {
    getAbortCache().put({
      key: getAbortCacheKey(),
      value: JSON.stringify({
        aborted: true,
        timestamp: new Date().toISOString(),
        details
      }),
      ttl: CACHE_TTL_SECONDS
    });
  };

  const isAbortFlagSet = () => {
    const raw = getAbortCache().get({ key: getAbortCacheKey() });
    if (!raw || raw === 'F') {
      return false;
    }
    return true;
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
      key: getMetaCacheKey(),
      value: JSON.stringify(payload),
      ttl: CACHE_TTL_SECONDS
    });
  };

  const loadColumnMetadata = (config, inputQuery) => {
    const raw = getMetaCache().get({ key: getMetaCacheKey() });
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

  const normalizeAction = (rawValue) => {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return DEFAULT_ACTION;
    }
    return rawValue.toString().trim().toLowerCase();
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

  const createRecord = (recordType, bodyValues) => {
    const createdRecord = record.create({
      type: recordType,
      isDynamic: false
    });

    Object.keys(bodyValues).forEach((fieldId) => {
      createdRecord.setValue({
        fieldId,
        value: bodyValues[fieldId]
      });
    });

    return createdRecord.save({
      enableSourcing: false,
      ignoreMandatoryFields: true
    });
  };

  const deleteRecord = (recordType, recordId) => record.delete({ type: recordType, id: recordId });
  const buildUpdateReduceKey = (recordType, recordId) => `upd::${recordType}::${recordId}`;
  const isUpdateReduceKey = (key) => key.startsWith('upd::');

  const sortDeferredOperations = (operations) => operations.sort((left, right) => {
    const leftSeq = left.operationSequence;
    const rightSeq = right.operationSequence;
    if (leftSeq === null && rightSeq === null) {
      return 0;
    }
    if (leftSeq === null) {
      return 1;
    }
    if (rightSeq === null) {
      return -1;
    }
    return leftSeq - rightSeq;
  });

  const getInputData = () => {
    const config = readConfig();

    if (!config.suiteql) {
      throw Error('Missing required SuiteQL parameter: custscript_th_dp_suiteql');
    }

    clearAbortFlag();

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
        nonUpdateActionsEnabled: config.enableActions,
        stopOnError: config.stopOnError,
        maxRows: config.maxRows,
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

    if (config.stopOnError && isAbortFlagSet()) {
      context.write({ key: 'aborted', value: '1' });
      return;
    }

    const row = materializeRow(columnNames, valuesArray);
    const action = normalizeAction(row.action);
    const recordType = row.recordtype;
    const recordId = row.recordid;
    const bodyValues = buildAliasValues(row, config.aliasPrefix);
    const lineValues = buildAliasValues(row, DEFAULT_LINE_ALIAS_PREFIX);
    const bodyFieldIds = Object.keys(bodyValues);
    const lineFieldIds = Object.keys(lineValues);

    if (!recordType) {
      log.error({ title: 'Skipped row: recordtype is required', details: { row, action } });
      context.write({ key: 'skipped', value: '1' });
      return;
    }

    if (action !== 'update' && !config.enableActions) {
      log.error({
        title: 'Skipped row: non-update action is disabled',
        details: { action, recordType, recordId }
      });
      context.write({ key: 'skipped', value: '1' });
      return;
    }

    if (action === 'update') {
      if (!recordId) {
        log.error({ title: 'Skipped row: recordid is required for update', details: { row } });
        context.write({ key: 'skipped', value: '1' });
        return;
      }

      if (!bodyFieldIds.length && !lineFieldIds.length) {
        log.audit({
          title: 'Skipped row: no update aliases found',
          details: { recordType, recordId, aliasPrefix: config.aliasPrefix, lineAliasPrefix: DEFAULT_LINE_ALIAS_PREFIX }
        });
        context.write({ key: 'skipped', value: '1' });
        return;
      }

      const needsDeferredLoadSave = lineFieldIds.length || config.forceLoadSave;
      const effectiveMode = lineFieldIds.length
        ? 'sublist-load-save-reduce'
        : (config.forceLoadSave ? 'load-save-reduce' : 'inline-edit');

      if (config.dryRun) {
        log.audit({
          title: 'Dry run patch preview',
          details: {
            action,
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

      if (needsDeferredLoadSave) {
        context.write({
          key: buildUpdateReduceKey(recordType, recordId),
          value: JSON.stringify({
            recordType,
            recordId,
            bodyValues,
            lineValues,
            locator: getLineLocator(row),
            operationSequence: toIntegerOrNull(row.operationsequence)
          })
        });
        return;
      }

      try {
        if (config.stopOnError && isAbortFlagSet()) {
          context.write({ key: 'aborted', value: '1' });
          return;
        }

        applyBySubmitFields(recordType, recordId, bodyValues);

        log.audit({
          title: 'Patched record',
          details: {
            action,
            recordType,
            recordId,
            mode: effectiveMode,
            bodyFieldIds,
            lineFieldIds,
            sublistId: '',
            lineIndex: ''
          }
        });
        context.write({ key: 'patched', value: '1' });
      } catch (error) {
        log.error({
          title: 'Patch failure',
          details: {
            action,
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
          setAbortFlag({ stage: 'map-update', recordType, recordId, errorName: error.name });
        }
      }
      return;
    }

    if (action === 'create') {
      if (lineFieldIds.length) {
        log.error({ title: 'Create does not support linefield_* aliases', details: { row } });
        context.write({ key: 'failed', value: '1' });
        if (config.stopOnError) {
          setAbortFlag({ stage: 'map-create-validate', recordType, errorName: 'INVALID_LINE_ALIAS' });
        }
        return;
      }

      if (!bodyFieldIds.length) {
        log.error({ title: 'Skipped row: create requires at least one fieldid_* value', details: { row } });
        context.write({ key: 'skipped', value: '1' });
        return;
      }

      if (config.dryRun) {
        log.audit({ title: 'Dry run create preview', details: { action, recordType, values: bodyValues } });
        context.write({ key: 'previewed', value: '1' });
        return;
      }

      try {
        if (config.stopOnError && isAbortFlagSet()) {
          context.write({ key: 'aborted', value: '1' });
          return;
        }

        const newId = createRecord(recordType, bodyValues);
        log.audit({ title: 'Created record', details: { action, recordType, newId, bodyFieldIds } });
        context.write({ key: 'created', value: '1' });
      } catch (error) {
        log.error({
          title: 'Create failure',
          details: { action, recordType, bodyFieldIds, errorName: error.name, errorMessage: error.message }
        });
        context.write({ key: 'failed', value: '1' });
        if (config.stopOnError) {
          setAbortFlag({ stage: 'map-create', recordType, errorName: error.name });
        }
      }
      return;
    }

    if (action === 'delete') {
      if (!recordId) {
        log.error({ title: 'Skipped row: recordid is required for delete', details: { row } });
        context.write({ key: 'skipped', value: '1' });
        return;
      }

      if (config.dryRun) {
        log.audit({ title: 'Dry run delete preview', details: { action, recordType, recordId } });
        context.write({ key: 'previewed', value: '1' });
        return;
      }

      try {
        if (config.stopOnError && isAbortFlagSet()) {
          context.write({ key: 'aborted', value: '1' });
          return;
        }

        deleteRecord(recordType, recordId);
        log.audit({ title: 'Deleted record', details: { action, recordType, recordId } });
        context.write({ key: 'deleted', value: '1' });
      } catch (error) {
        log.error({
          title: 'Delete failure',
          details: { action, recordType, recordId, errorName: error.name, errorMessage: error.message }
        });
        context.write({ key: 'failed', value: '1' });
        if (config.stopOnError) {
          setAbortFlag({ stage: 'map-delete', recordType, recordId, errorName: error.name });
        }
      }
      return;
    }

    log.error({ title: 'Skipped row: unsupported action value', details: { action, recordType, recordId } });
    context.write({ key: 'skipped', value: '1' });
  };

  const reduce = (context) => {
    if (isUpdateReduceKey(context.key)) {
      const config = readConfig();
      const operations = context.values.map((value) => JSON.parse(value));
      const sortedOperations = sortDeferredOperations(operations);

      if (config.stopOnError && isAbortFlagSet()) {
        context.write({ key: 'aborted', value: String(sortedOperations.length) });
        return;
      }

      const first = sortedOperations[0];

      try {
        const loadedRecord = record.load({
          type: first.recordType,
          id: first.recordId,
          isDynamic: false
        });

        sortedOperations.forEach((operation) => {
          const bodyFieldIds = Object.keys(operation.bodyValues || {});
          const lineFieldIds = Object.keys(operation.lineValues || {});

          bodyFieldIds.forEach((fieldId) => {
            loadedRecord.setValue({
              fieldId,
              value: operation.bodyValues[fieldId]
            });
          });

          if (lineFieldIds.length) {
            const lineIndex = resolveLineIndex(loadedRecord, operation.locator);
            lineFieldIds.forEach((fieldId) => {
              loadedRecord.setSublistValue({
                sublistId: operation.locator.sublistId,
                fieldId,
                line: lineIndex,
                value: operation.lineValues[fieldId]
              });
            });
          }
        });

        if (config.stopOnError && isAbortFlagSet()) {
          context.write({ key: 'aborted', value: String(sortedOperations.length) });
          return;
        }

        loadedRecord.save({
          enableSourcing: false,
          ignoreMandatoryFields: true
        });

        log.audit({
          title: 'Patched record in reduce',
          details: {
            recordType: first.recordType,
            recordId: first.recordId,
            operationCount: sortedOperations.length
          }
        });
        context.write({ key: 'patched', value: String(sortedOperations.length) });
      } catch (error) {
        log.error({
          title: 'Reduce patch failure',
          details: {
            recordType: first.recordType,
            recordId: first.recordId,
            operationCount: sortedOperations.length,
            errorName: error.name,
            errorMessage: error.message
          }
        });
        context.write({ key: 'failed', value: String(sortedOperations.length) });
        if (config.stopOnError) {
          setAbortFlag({ stage: 'reduce-update', recordType: first.recordType, recordId: first.recordId, errorName: error.name });
        }
      }
      return;
    }

    let total = 0;
    context.values.forEach((value) => {
      total += parseInt(value, 10) || 0;
    });
    context.write({ key: context.key, value: String(total) });
  };

  const summarize = (summary) => {
    const totals = {
      patched: 0,
      created: 0,
      deleted: 0,
      previewed: 0,
      failed: 0,
      skipped: 0,
      aborted: 0,
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
