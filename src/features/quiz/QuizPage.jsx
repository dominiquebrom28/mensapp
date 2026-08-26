// Top-level quiz page (docs/quiz-unification-spec.md §8.1/§14 decision 1) --
// reached from `Nav`/`Home`'s "🧠 Quiz" entry, because a quiz need not
// belong to an event (the owner's own framing: "its own general feature,
// that CAN be connected to an event"). `App.jsx` mounts this via
// `lazy(() => import("./features/quiz/QuizPage.jsx"))`, mirroring
// `mensgames/MensGamesPage.jsx`; this file's only job is to be that lazy
// default export and set `scope`. The actual UI lives in `QuizShell.jsx`,
// shared with `QuizTabMount.jsx`.
import QuizShell from './QuizShell.jsx';

export default function QuizPage(props) {
  return <QuizShell {...props} scope="page" />;
}
