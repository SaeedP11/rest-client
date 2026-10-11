export enum SimpleFilterOperator {
  EQ = "EQ",
  GT = "GT",
  GTE = "GTE",
  LT = "LT",
  LTE = "LTE",
  NE = "NE",
  //! Use for List type
  IN = "IN",
  NOT_IN = "NOT_IN",
  BETWEEN = "BETWEEN",
  NOT_BETWEEN = "NOT_BETWEEN",
  //! Use for String type
  LIKE = "LIKE",
  ILIKE = "ILIKE",
  IREGEXP = "IREGEXP",
  NOT_ILIKE = "NOT_ILIKE",
  NOT_IREGEXP = "NOT_IREGEXP",
  NOT_LIKE = "NOT_LIKE",
  REGEXP = "REGEXP",
  NOT_REGEXP = "NOT_REGEXP",
  //! Use for Boolean type
  IS = "IS",
  NOT = "NOT",
  ELM_MTC = "ELM_MTC",
}
