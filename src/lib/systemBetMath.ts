export function combinationCount(selectionCount: number, combinationSize: number) {
  if (combinationSize < 0 || selectionCount < combinationSize) return 0;
  const size = Math.min(combinationSize, selectionCount - combinationSize);
  let result = 1;
  for (let index = 1; index <= size; index += 1) {
    result = (result * (selectionCount - size + index)) / index;
  }
  return Math.round(result);
}

export function systemBetPotentialReturn(odds: number[], combinationSize: number, totalStake: number) {
  const products: number[] = [];
  function visit(start: number, depth: number, product: number) {
    if (depth === combinationSize) { products.push(product); return; }
    for (let index = start; index <= odds.length - (combinationSize - depth); index += 1) {
      visit(index + 1, depth + 1, product * odds[index]);
    }
  }
  visit(0, 0, 1);
  const lineStake = products.length ? Math.round((totalStake / products.length) * 100) / 100 : 0;
  return {
    lineCount: products.length,
    lineStake,
    potentialReturn: Math.round(products.reduce((sum, product) => sum + lineStake * product, 0) * 100) / 100,
  };
}
