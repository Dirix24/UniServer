function invalid(message) {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

const text = (max, min = 1) => value =>
  typeof value === 'string' && value.length <= max && value.trim().length >= min &&
  !/[\x00-\x1f\x7f]/.test(value);
const nullable = validate => value => value === null || validate(value);
const array = (validate, max) => value => Array.isArray(value) && value.length <= max && value.every(validate);
const boolean = value => typeof value === 'boolean';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function fields(body, schema, required = []) {
  if (!object(body)) invalid('Se requiere un objeto JSON');
  for (const name of required) if (!Object.hasOwn(body, name)) invalid(name + ' es obligatorio');
  for (const [name, value] of Object.entries(body)) {
    if (!Object.hasOwn(schema, name) || !schema[name](value)) invalid('Campo no autorizado o inválido');
  }
  return body;
}

const username = text(128);
const password = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const id = nullable(text(128));

module.exports = { invalid, fields, text, nullable, array, boolean, object, username, password, id };
