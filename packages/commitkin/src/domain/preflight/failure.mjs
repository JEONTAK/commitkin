/** Only fixed diagnostics cross the read-only preflight boundary. */
export class PreflightFailure extends Error {
  constructor(stage, code, decision = 'rejected') {
    super(code);
    this.stage = stage;
    this.code = code;
    this.decision = decision;
  }
}

export function requirePreflight(condition, stage, code, decision = 'rejected') {
  if (!condition) throw new PreflightFailure(stage, code, decision);
}
