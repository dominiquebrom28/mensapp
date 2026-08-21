// Top-level mens-games page (docs/mensgames-spec.md §4.6 #1) -- reached
// from `Nav`/`Home`'s "🏆 Mens-Games" entry, because a tournament need not
// belong to an event. `App.jsx` mounts this via
// `lazy(() => import("./features/mensgames/MensGamesPage.jsx"))` (§5.3);
// this file's only job is to be that lazy default export and set `scope`.
// The actual UI lives in `MensGamesShell.jsx`, shared with `MensGamesTab.jsx`.
import MensGamesShell from './MensGamesShell.jsx';

export default function MensGamesPage(props) {
  return <MensGamesShell {...props} scope="page" />;
}
