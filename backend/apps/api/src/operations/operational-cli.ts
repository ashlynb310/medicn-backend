export function flagValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`A value is required for ${name}.`);
  }
  return value;
}

export function requiredFlag(name: string) {
  const value = flagValue(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function boundedLimit() {
  const value = flagValue("--limit");
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 25) {
    throw new Error("--limit must be an integer from 1 through 25.");
  }
  return parsed;
}

export function requestedHelp() {
  return process.argv.includes("--help") || process.argv.includes("-h");
}
