import yaml, { YAMLException } from 'js-yaml';
import type { ValidateYamlResponse } from '../../shared/api';

export function validateAutomodYaml(content: string): ValidateYamlResponse {
  if (!content.trim()) {
    return { type: 'validate-yaml', valid: true, message: 'YAML is valid' };
  }

  try {
    yaml.loadAll(content);
    return { type: 'validate-yaml', valid: true, message: 'YAML is valid' };
  } catch (error) {
    if (error instanceof YAMLException) {
      return {
        type: 'validate-yaml',
        valid: false,
        message: error.message || 'Invalid YAML',
        line: error.mark.line + 1,
        column: error.mark.column + 1,
      };
    }

    return {
      type: 'validate-yaml',
      valid: false,
      message: error instanceof Error ? error.message : 'Invalid YAML',
    };
  }
}
