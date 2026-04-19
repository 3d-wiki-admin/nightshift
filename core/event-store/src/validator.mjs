import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.resolve(__dirname, '../../schemas');

function loadSchema(name) {
  return JSON.parse(readFileSync(path.join(schemasDir, name), 'utf8'));
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const eventValidator = ajv.compile(loadSchema('event.schema.json'));
const stateValidator = ajv.compile(loadSchema('state.schema.json'));
const contractValidator = ajv.compile(loadSchema('contract.schema.json'));
const manifestValidator = ajv.compile(loadSchema('manifest.schema.json'));

function wrap(validator) {
  return (value) => {
    const ok = validator(value);
    if (ok) return { ok: true, errors: [] };
    const errors = (validator.errors || []).map(e => `${e.instancePath || '/'} ${e.message}`);
    return { ok: false, errors };
  };
}

export const validateEvent = wrap(eventValidator);
export const validateState = wrap(stateValidator);
export const validateContract = wrap(contractValidator);
export const validateManifest = wrap(manifestValidator);
