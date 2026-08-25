// Eager, tiny (docs/quiz-unification-spec.md §4.5, §8.1) -- App root's
// discovery hook for "is a quiz live anywhere, right now", powering the
// dismissible app-wide "🔴 Quiz bezig — meedoen" banner. Not part of the
// lazy quiz chunk: it has to run even for a user who never opens the quiz
// feature at all, since the banner is what invites them in.
//
// Combines `subscribeLiveQuizFeed` (instant, but "realtime may not deliver"
// per §17 risk 3) with a 30 s safety poll (§4.2's App-root row) -- so a
// phone with realtime blocked still finds a live quiz, just up to 30 s
// later instead of instantly, degrading to "slightly slow" rather than
// "never".
import { useEffect, useRef, useState } from 'react';
import { fetchLiveQuizzes } from './api.js';
import { subscribeLiveQuizFeed } from './live.js';

const POLL_MS = 30000;

/**
 * @returns {{ liveQuizzes: {id:string,title:string,eventId:string|null}[], error: unknown }}
 */
export function useLiveQuizWatch() {
  const [liveQuizzes, setLiveQuizzes] = useState([]);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const load = () => {
      fetchLiveQuizzes().then(res => {
        if (!mountedRef.current) return;
        if (res.ok) {
          setLiveQuizzes(res.liveQuizzes);
          setError(null);
        } else {
          // Deliberately keep whatever `liveQuizzes` we already had -- a
          // transient read failure shouldn't yank an already-shown banner
          // out from under someone mid-event.
          setError(res.error);
        }
      });
    };

    load();
    const unsubscribe = subscribeLiveQuizFeed(load);
    const poll = setInterval(load, POLL_MS);

    return () => {
      mountedRef.current = false;
      unsubscribe();
      clearInterval(poll);
    };
  }, []);

  return { liveQuizzes, error };
}
