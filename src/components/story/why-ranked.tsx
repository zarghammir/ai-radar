/**
 * "Why is this ranked here?" — the ranker explaining itself.
 *
 * COLLAPSED BY DEFAULT because it is the developer panel #15 asks for, not
 * something a reader needs to get through the story. A `details` element
 * rather than state: it works before JavaScript runs, it is keyboard operable
 * for free, and a screen reader announces it as expandable without help.
 *
 * THE SUM IS CHECKED AND A MISMATCH IS SAID OUT LOUD. The acceptance is that
 * these numbers add up to the score shown — so this renders the arithmetic
 * rather than asserting it. If the components ever stop summing to the total,
 * a panel that quietly showed both numbers would let a reader "verify" a
 * figure that does not follow from its own parts, which is worse than showing
 * no explanation at all: it lends the score a credibility it has not earned.
 */
export function WhyRanked({
  components,
  total,
}: {
  components: { key: string; label: string; value: number }[];
  total: number;
}) {
  // No components means the story predates the ranker writing them down. That
  // is "not recorded", not "scored zero", and the panel says which.
  if (components.length === 0) {
    return (
      <details className="border-faint mt-6 border-t pt-3" data-why-ranked="none">
        <summary className="text-soft cursor-pointer text-[13px]">Why is this ranked here?</summary>
        <p className="text-ash mt-2 text-[13.5px] leading-relaxed">
          This story scored <b className="tabular-nums">{total}</b>, but its individual components
          were not recorded — it was ranked before the ranker began writing them down. That is a
          missing explanation rather than a score of nothing.
        </p>
      </details>
    );
  }

  const sum = components.reduce((n, c) => n + c.value, 0);
  const agrees = sum === total;

  return (
    <details
      className="border-faint mt-6 border-t pt-3"
      data-why-ranked={agrees ? "sums" : "mismatch"}
    >
      <summary className="text-soft cursor-pointer text-[13px]">Why is this ranked here?</summary>
      <table className="mt-2 w-full max-w-md text-[13.5px]">
        <tbody>
          {components.map((c) => (
            <tr key={c.key} className="border-faint border-b last:border-b-0">
              <td className="py-1 pr-3">{c.label}</td>
              <td className="py-1 text-right tabular-nums">{c.value}</td>
            </tr>
          ))}
          <tr>
            <td className="text-ink py-1 pr-3 font-bold">Total</td>
            <td className="text-ink py-1 text-right font-bold tabular-nums">{total}</td>
          </tr>
        </tbody>
      </table>
      {!agrees ? (
        <p className="text-ash mt-2 text-[12.5px] leading-relaxed">
          These components add up to <b className="tabular-nums">{sum}</b>, not{" "}
          <b className="tabular-nums">{total}</b>. The total is what ordered your brief; the
          difference means a component was not recorded, so treat this breakdown as incomplete
          rather than as the whole reason.
        </p>
      ) : null}
    </details>
  );
}
