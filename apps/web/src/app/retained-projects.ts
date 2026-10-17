/** Retain only visited projects for this workbench lifetime; authoritative removal releases their UI resources. */
export function retainedProjects(
  previous: readonly number[],
  selected: number | null,
  visible: boolean,
  available?: readonly number[],
): readonly number[] {
  const next = available === undefined ? [...previous] : previous.filter((id) => available.includes(id));
  if (
    visible &&
    selected !== null &&
    (available === undefined || available.includes(selected)) &&
    !next.includes(selected)
  )
    next.push(selected);
  return next.length === previous.length && next.every((id, index) => previous[index] === id) ? previous : next;
}
