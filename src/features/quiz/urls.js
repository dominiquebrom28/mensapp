// Quiz music-round URL helpers -- moved out of App.jsx verbatim (docs/
// quiz-unification-spec.md §8.1, §8.3). Pure string parsing, no React, no
// Supabase. App.jsx re-exports these from here rather than duplicating
// them, so QuizBuilder's validation and QuizPresenter/QuizParticipantView's
// embeds stay byte-identical to the code that shipped before this move.
export const getYouTubeId = url => {
  const m = url?.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : null;
};

export const getSpotifyTrackId = url => {
  const m = url?.match(/spotify\.com\/(?:intl-[a-z-]+\/)?track\/([\w]+)/);
  return m ? m[1] : null;
};

export const isSpotifyUrl = url => /spotify\.com\//.test(url || '');

export const isYouTubeUrl = url => /youtu(be\.com|\.be)\//.test(url || '');
