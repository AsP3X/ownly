// Human: Catalog of Excel functions for the Insert Function dialog.
// Agent: READ by ExcelInsertFunctionDialog; GROUPED by Excel category labels.

export type FormulaCatalogEntry = {
  name: string;
  category: string;
  description: string;
  syntax: string;
};

export const FORMULA_CATALOG: FormulaCatalogEntry[] = [
  { name: "SUM", category: "Math", description: "Adds numbers.", syntax: "SUM(number1, [number2], ...)" },
  { name: "AVERAGE", category: "Statistical", description: "Returns the average.", syntax: "AVERAGE(number1, [number2], ...)" },
  { name: "COUNT", category: "Statistical", description: "Counts numbers.", syntax: "COUNT(value1, [value2], ...)" },
  { name: "COUNTA", category: "Statistical", description: "Counts non-empty cells.", syntax: "COUNTA(value1, [value2], ...)" },
  { name: "MIN", category: "Statistical", description: "Returns the minimum.", syntax: "MIN(number1, [number2], ...)" },
  { name: "MAX", category: "Statistical", description: "Returns the maximum.", syntax: "MAX(number1, [number2], ...)" },
  { name: "MEDIAN", category: "Statistical", description: "Returns the median.", syntax: "MEDIAN(number1, [number2], ...)" },
  { name: "IF", category: "Logical", description: "Conditional value.", syntax: "IF(logical_test, value_if_true, [value_if_false])" },
  { name: "AND", category: "Logical", description: "All arguments true.", syntax: "AND(logical1, [logical2], ...)" },
  { name: "OR", category: "Logical", description: "Any argument true.", syntax: "OR(logical1, [logical2], ...)" },
  { name: "NOT", category: "Logical", description: "Reverses logic.", syntax: "NOT(logical)" },
  { name: "IFERROR", category: "Logical", description: "Value if error.", syntax: "IFERROR(value, value_if_error)" },
  { name: "IFNA", category: "Logical", description: "Value if #N/A.", syntax: "IFNA(value, value_if_na)" },
  { name: "VLOOKUP", category: "Lookup", description: "Vertical lookup.", syntax: "VLOOKUP(lookup, table, col, [range_lookup])" },
  { name: "HLOOKUP", category: "Lookup", description: "Horizontal lookup.", syntax: "HLOOKUP(lookup, table, row, [range_lookup])" },
  { name: "XLOOKUP", category: "Lookup", description: "Modern lookup.", syntax: "XLOOKUP(lookup, lookup_array, return_array)" },
  { name: "INDEX", category: "Lookup", description: "Value at index.", syntax: "INDEX(array, row, [col])" },
  { name: "MATCH", category: "Lookup", description: "Position in range.", syntax: "MATCH(lookup, lookup_array, [match_type])" },
  { name: "SUMIF", category: "Math", description: "Sum by criteria.", syntax: "SUMIF(range, criteria, [sum_range])" },
  { name: "COUNTIF", category: "Math", description: "Count by criteria.", syntax: "COUNTIF(range, criteria)" },
  { name: "SUMIFS", category: "Math", description: "Sum by multiple criteria.", syntax: "SUMIFS(sum_range, range1, criteria1, ...)" },
  { name: "COUNTIFS", category: "Math", description: "Count by multiple criteria.", syntax: "COUNTIFS(range1, criteria1, ...)" },
  { name: "FILTER", category: "Dynamic array", description: "Filter an array.", syntax: "FILTER(array, include)" },
  { name: "SORT", category: "Dynamic array", description: "Sort an array.", syntax: "SORT(array)" },
  { name: "UNIQUE", category: "Dynamic array", description: "Distinct values.", syntax: "UNIQUE(array)" },
  { name: "SEQUENCE", category: "Dynamic array", description: "Generate sequence.", syntax: "SEQUENCE(rows, [cols], [start], [step])" },
  { name: "CONCAT", category: "Text", description: "Join text.", syntax: "CONCAT(text1, [text2], ...)" },
  { name: "LEFT", category: "Text", description: "Left characters.", syntax: "LEFT(text, [num_chars])" },
  { name: "RIGHT", category: "Text", description: "Right characters.", syntax: "RIGHT(text, [num_chars])" },
  { name: "MID", category: "Text", description: "Middle characters.", syntax: "MID(text, start, num_chars)" },
  { name: "TRIM", category: "Text", description: "Trim spaces.", syntax: "TRIM(text)" },
  { name: "UPPER", category: "Text", description: "Uppercase.", syntax: "UPPER(text)" },
  { name: "LOWER", category: "Text", description: "Lowercase.", syntax: "LOWER(text)" },
  { name: "TODAY", category: "Date", description: "Today's date.", syntax: "TODAY()" },
  { name: "NOW", category: "Date", description: "Current date/time.", syntax: "NOW()" },
  { name: "DATE", category: "Date", description: "Build date serial.", syntax: "DATE(year, month, day)" },
  { name: "NPV", category: "Financial", description: "Net present value.", syntax: "NPV(rate, value1, [value2], ...)" },
  { name: "IRR", category: "Financial", description: "Internal rate of return.", syntax: "IRR(values, [guess])" },
  { name: "PMT", category: "Financial", description: "Loan payment.", syntax: "PMT(rate, nper, pv)" },
  { name: "STDEV", category: "Statistical", description: "Sample standard deviation.", syntax: "STDEV(number1, [number2], ...)" },
];

export const FORMULA_CATEGORIES = [...new Set(FORMULA_CATALOG.map((entry) => entry.category))].sort();
