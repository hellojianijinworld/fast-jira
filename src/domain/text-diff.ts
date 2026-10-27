/** 공통 앞뒤를 제외한 변경 범위를 구한다. Unicode 문자를 중간에서 자르지 않는다. */
export function textDifference(from: string, to: string) {
  const before = [...from],
    after = [...to];
  let start = 0,
    end = 0;
  while (
    start < Math.min(before.length, after.length) &&
    before[start] === after[start]
  )
    start++;
  while (
    end < Math.min(before.length, after.length) - start &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++;
  return {
    prefix: before.slice(0, start).join(""),
    before: before.slice(start, before.length - end).join(""),
    after: after.slice(start, after.length - end).join(""),
    suffix: end ? before.slice(-end).join("") : "",
  };
}
