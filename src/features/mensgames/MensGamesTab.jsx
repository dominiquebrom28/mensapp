// Event-scoped mens-games tab (docs/mensgames-spec.md §4.6 #2) -- appended
// to `TABS` as `"Mens-Games 🏆"`, listing tournaments where
// `event_id===evt.id`. `App.jsx` mounts this via
// `lazy(() => import("./features/mensgames/MensGamesTab.jsx"))` (§5.3);
// this file's only job is to be that lazy default export and set `scope`.
// The actual UI lives in `MensGamesShell.jsx`, shared with `MensGamesPage.jsx`.
import MensGamesShell from './MensGamesShell.jsx';

export default function MensGamesTab(props) {
  return <MensGamesShell {...props} scope="event" />;
}
