const MAX_BIGINT = 9_223_372_036_854_775_807n;

export class ExpenseCalculationError extends Error {}

export function parseQuantity(value: string): { canonical: string; scaled: bigint } {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value)) throw new ExpenseCalculationError("Quantity Expense harus berupa angka positif dengan maksimal 3 digit desimal.");
  const [whole, fraction = ""] = value.split(".");
  const scaled = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0") || "0");
  if (scaled <= 0n || scaled > MAX_BIGINT * 1000n) throw new ExpenseCalculationError("Quantity Expense tidak valid.");
  return { canonical: `${whole}.${fraction.padEnd(3, "0")}`, scaled };
}

export function parseUnitPrice(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new ExpenseCalculationError("Harga satuan Expense harus berupa Rupiah bulat.");
  const price = BigInt(value);
  if (price <= 0n || price > MAX_BIGINT) throw new ExpenseCalculationError("Harga satuan Expense harus lebih besar dari Rp0.");
  return price;
}

export function calculateLine(quantity: string, unitPrice: string) {
  const parsedQuantity = parseQuantity(quantity);
  const price = parseUnitPrice(unitPrice);
  const product = parsedQuantity.scaled * price;
  const lineAmount = (product + 500n) / 1000n;
  if (lineAmount <= 0n || lineAmount > MAX_BIGINT) throw new ExpenseCalculationError("Nilai baris Expense di luar batas BIGINT.");
  return { quantity: parsedQuantity.canonical, unitPrice: price, lineAmount };
}

export function calculateExpense(items: Array<{ description: string; quantity: string; unitPrice: string }>) {
  if (!items.length) throw new ExpenseCalculationError("Expense harus memiliki minimal satu item.");
  let total = 0n;
  const calculated = items.map((item, index) => {
    const description = item.description.trim();
    if (!description || description.length > 300) throw new ExpenseCalculationError("Deskripsi item Expense tidak valid.");
    const line = calculateLine(item.quantity, item.unitPrice);
    total += line.lineAmount;
    if (total > MAX_BIGINT) throw new ExpenseCalculationError("Total Expense di luar batas BIGINT.");
    return { lineNumber: index + 1, description, ...line };
  });
  return { items: calculated, totalAmount: total };
}

export { MAX_BIGINT };
