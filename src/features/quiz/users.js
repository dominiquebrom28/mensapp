// User-lookup helpers, copied verbatim from App.jsx's own `getUA`/
// `getDisplayName` (docs/quiz-unification-spec.md §8.1) -- unexported
// App.jsx `const`s (docs/mensgames-spec.md §5.4), so the moved quiz
// components import their own copy here instead.
export const getUA = (name, users = []) => { const u = users.find(x => x.username?.toLowerCase() === name?.toLowerCase()); return { index: u?.animal_avatar ?? u?.avatar ?? 0, photoUrl: u?.photo_url || "" }; };
export const getDisplayName = (name, users = []) => { const u = users.find(x => x.username?.toLowerCase() === name?.toLowerCase()); return u?.display_name || name; };
