import { redactError } from "./redact.mjs";

const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function protocolValue(value) {
  if (typeof value === "string") return redactError(value);
  if (Array.isArray(value)) return value.map(protocolValue);
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, protocolValue(item)]));
  return value;
}

function titledChoices(schema, key, multi = false) {
  const titledKey = multi ? "anyOf" : "oneOf";
  if (own(schema, "enum") && own(schema, titledKey)) throw invalid("A question field cannot combine enum and titled choices.");
  if (own(schema, "enum")) {
    if (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.some((value) => typeof value !== "string")) {
      throw invalid("Question enum values must be non-empty strings.");
    }
    return schema.enum;
  }
  if (own(schema, titledKey)) {
    if (!Array.isArray(schema[titledKey]) || !schema[titledKey].length || schema[titledKey].some((choice) => !record(choice) || typeof choice.const !== "string" || typeof choice.title !== "string" || !choice.title.trim())) {
      throw invalid("Question choices require string const values and titles.");
    }
    return schema[titledKey].map((choice) => choice.const);
  }
  return null;
}

function normalizeField(schema, multi = false) {
  if (!record(schema) || typeof schema.type !== "string") throw invalid("Every question field requires a supported type.");
  if (multi) {
    if (schema.type !== "string") throw invalid("Multi-select items must be strings.");
    return titledChoices(schema, "items", true);
  }
  if (schema.type === "string") {
    titledChoices(schema, "field");
    for (const key of ["minLength", "maxLength"]) {
      if (own(schema, key) && (!Number.isInteger(schema[key]) || schema[key] < 0)) throw invalid(`Question ${key} must be a non-negative integer.`);
    }
    if (schema.minLength > schema.maxLength) throw invalid("Question minLength cannot exceed maxLength.");
    if (own(schema, "pattern")) {
      try { new RegExp(schema.pattern); } catch { throw invalid("Question pattern is not a valid ECMA-262 expression."); }
    }
    return null;
  }
  if (schema.type === "number" || schema.type === "integer") {
    for (const key of ["minimum", "maximum"]) {
      if (own(schema, key) && (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))) throw invalid(`Question ${key} must be finite.`);
    }
    if (schema.minimum > schema.maximum) throw invalid("Question minimum cannot exceed maximum.");
    return null;
  }
  if (schema.type === "boolean") return null;
  if (schema.type === "array") {
    const choices = normalizeField(schema.items, true);
    if (!choices) throw invalid("Multi-select fields require string choices.");
    for (const key of ["minItems", "maxItems"]) {
      if (own(schema, key) && (!Number.isInteger(schema[key]) || schema[key] < 0)) throw invalid(`Question ${key} must be a non-negative integer.`);
    }
    if (schema.minItems > schema.maxItems) throw invalid("Question minItems cannot exceed maxItems.");
    return choices;
  }
  throw invalid(`Unsupported question field type: ${schema.type}.`);
}

export function normalizeForm(params) {
  if (params?.mode !== "form") throw invalid("Only session-scoped form questions are supported.");
  if (!record(params.requestedSchema)) throw invalid("Question requestedSchema must be an object.");
  const schema = protocolValue(params.requestedSchema);
  if (schema.type !== "object" || !record(schema.properties)) throw invalid("Question schema must be a flat object with properties.");
  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some((key) => typeof key !== "string") || new Set(required).size !== required.length) {
    throw invalid("Question required fields must be unique strings.");
  }
  for (const key of required) if (!own(schema.properties, key)) throw invalid(`Required question field is missing: ${key}.`);
  for (const [key, field] of Object.entries(schema.properties)) {
    if (!key) throw invalid("Question field names cannot be empty.");
    normalizeField(field);
  }
  return {
    title: typeof schema.title === "string" ? schema.title : "",
    description: typeof schema.description === "string" ? schema.description : "",
    properties: schema.properties,
    required,
  };
}

function validateValue(key, schema, value) {
  if (schema.type === "string") {
    if (typeof value !== "string") throw invalid(`Question ${key} requires text.`);
    if (schema.minLength !== undefined && value.length < schema.minLength) throw invalid(`Question ${key} is shorter than minLength.`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw invalid(`Question ${key} is longer than maxLength.`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) throw invalid(`Question ${key} does not match its pattern.`);
    const choices = titledChoices(schema, key);
    if (choices && !choices.includes(value)) throw invalid(`Question ${key} requires one of the offered choices.`);
    return value;
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) {
      throw invalid(`Question ${key} requires ${schema.type === "integer" ? "an integer" : "a number"}.`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) throw invalid(`Question ${key} is below minimum.`);
    if (schema.maximum !== undefined && value > schema.maximum) throw invalid(`Question ${key} is above maximum.`);
    return value;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw invalid(`Question ${key} requires true or false.`);
    return value;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw invalid(`Question ${key} requires a list of strings.`);
    const choices = titledChoices(schema.items, key, true);
    if (value.some((item) => !choices.includes(item))) throw invalid(`Question ${key} contains an unoffered choice.`);
    if (schema.minItems !== undefined && value.length < schema.minItems) throw invalid(`Question ${key} has too few choices.`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw invalid(`Question ${key} has too many choices.`);
    return value;
  }
  throw invalid(`Unsupported question field type: ${schema.type}.`);
}

export function validateFormContent(form, content) {
  if (!record(content)) throw invalid("Accepted questions require an object of answers.");
  for (const key of Object.keys(content)) if (!own(form.properties, key)) throw invalid(`Unknown question answer: ${key}.`);
  for (const key of form.required) if (!own(content, key)) throw invalid(`Missing required question answer: ${key}.`);
  return Object.fromEntries(Object.entries(content).map(([key, value]) => [key, validateValue(key, form.properties[key], value)]));
}
