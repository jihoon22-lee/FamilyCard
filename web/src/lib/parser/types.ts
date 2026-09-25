export type ParseReason =
  | 'NO_RULE'
  | 'INVALID_RULE'
  | 'EXTRACTION_FAILED'
  | 'INVALID_FIELDS'
  | 'UNSUPPORTED_FORMAT'
  | 'INPUT_TOO_LARGE';
export interface ParsingRule {
  id: string;
  issuer: string;
  version: number;
  action: 'PARSE' | 'IGNORE';
  priority: number;
  isActive: boolean;
  matchPattern: string;
  extractPattern: string;
  fieldMap: unknown;
}
export interface ParsedFields {
  issuer: string;
  amount: number | null;
  txType: 'APPROVAL' | 'CANCELLATION';
  approvedAt: string;
  originalApprovedAt: string | null;
  timePrecision: 'SECOND' | 'MINUTE' | 'DAY' | 'RECEIVED';
  merchantName: string;
  cardToken: string;
  installmentMonths: number;
  currency: string;
  foreignAmount: number | null;
  foreignScale: number | null;
  approvalReference: string | null;
}
export type ParseResult =
  | { status: 'PARSED'; ruleId: string; ruleVersion: number; fields: ParsedFields }
  | { status: 'IGNORED'; ruleId: string; ruleVersion: number; reason: 'RULE_IGNORED' }
  | { status: 'FAILED'; reason: ParseReason; ruleId?: string; ruleVersion?: number };
