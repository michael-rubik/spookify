import { HIDDEN_COSTUME_LABEL } from '../utils/costumes'

export const Costume = ({ costume }: { costume: string | null | undefined }) =>
  costume ? (
    <>{costume}</>
  ) : (
    <span className="costume-hidden" title="This costume is hidden">
      🙈 {HIDDEN_COSTUME_LABEL}
    </span>
  )
