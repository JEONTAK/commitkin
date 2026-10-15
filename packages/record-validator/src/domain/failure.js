/** Public failures contain fixed codes only: no input values, paths or parser messages. */
export class ValidationFailure extends Error {
  constructor(stage, code, decision = 'hold') {
    super(code);
    this.stage = stage;
    this.code = code;
    this.decision = decision;
  }
}

export function requireValid(condition, code, stage = 'semantic') {
  if (!condition) throw new ValidationFailure(stage, code);
}

export function failureReport(error) {
  if (!(error instanceof ValidationFailure)) {
    return { stage: 'internal', code: 'VALIDATOR_UNAVAILABLE', decision: 'hold' };
  }
  return { stage: error.stage, code: error.code, decision: error.decision };
}
