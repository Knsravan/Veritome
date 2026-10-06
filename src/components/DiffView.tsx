import { diffWords } from "@/core/text/diff";

export function DiffView({ before, after }: { before: string; after: string }) {
  const ops = diffWords(before, after);
  return (
    <div className="sheet-text">
      {ops.map((op, i) =>
        op.type === "same" ? (
          <span key={i}>{op.text}</span>
        ) : op.type === "add" ? (
          <ins key={i} className="diff-add">
            <span className="sr-only">[added: </span>
            {op.text}
            <span className="sr-only">]</span>
          </ins>
        ) : (
          <del key={i} className="diff-del">
            <span className="sr-only">[removed: </span>
            {op.text}
            <span className="sr-only">]</span>
          </del>
        ),
      )}
    </div>
  );
}
