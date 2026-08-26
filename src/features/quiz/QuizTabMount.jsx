// Event-scoped quiz tab (docs/quiz-unification-spec.md §8.1/§8.3 item 4) --
// appended to `TABS` as `"Quiz"`. `App.jsx` mounts this via
// `lazy(() => import("./features/quiz/QuizTabMount.jsx"))`, mirroring
// `mensgames/MensGamesTab.jsx`; this file's only job is to be that lazy
// default export and set `scope`. The actual UI lives in `QuizShell.jsx`,
// shared with `QuizPage.jsx` -- and owns the "open dashboard" state that
// used to live inline in `EventPage` (`quizDash`, dropped per §8.3 item 3).
import QuizShell from './QuizShell.jsx';

export default function QuizTabMount(props) {
  return <QuizShell {...props} scope="event" />;
}
