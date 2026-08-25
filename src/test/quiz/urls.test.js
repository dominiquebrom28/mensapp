// src/features/quiz/urls.js -- moved out of App.jsx verbatim. Same
// assertions `helpers.pure.test.js` used to make against sliced source.
import { describe, it, expect } from 'vitest';
import { getSpotifyTrackId, getYouTubeId, isSpotifyUrl, isYouTubeUrl } from '../../features/quiz/urls.js';

describe('getYouTubeId', () => {
  it('extracts the 11-char video id from common URL shapes', () => {
    expect(getYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(getYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(getYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(getYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(getYouTubeId('https://www.youtube.com/watch?list=abc&v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for a non-YouTube url, empty string, null or undefined', () => {
    expect(getYouTubeId('https://open.spotify.com/track/abc')).toBeNull();
    expect(getYouTubeId('')).toBeNull();
    expect(getYouTubeId(null)).toBeNull();
    expect(getYouTubeId(undefined)).toBeNull();
  });
});

describe('getSpotifyTrackId', () => {
  it('extracts the track id, with or without an intl- locale segment', () => {
    expect(getSpotifyTrackId('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBe('4uLU6hMCjMI75M1A2tKUQC');
    expect(getSpotifyTrackId('https://open.spotify.com/intl-nl/track/4uLU6hMCjMI75M1A2tKUQC')).toBe('4uLU6hMCjMI75M1A2tKUQC');
  });

  it('returns null for a non-Spotify url', () => {
    expect(getSpotifyTrackId('https://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(getSpotifyTrackId(null)).toBeNull();
  });
});

describe('isSpotifyUrl / isYouTubeUrl', () => {
  it('classify by domain', () => {
    expect(isSpotifyUrl('https://open.spotify.com/track/abc')).toBe(true);
    expect(isSpotifyUrl('https://youtu.be/abc')).toBe(false);
    expect(isYouTubeUrl('https://youtu.be/abc')).toBe(true);
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isYouTubeUrl('https://open.spotify.com/track/abc')).toBe(false);
  });

  it('never throw on empty/missing input', () => {
    expect(isSpotifyUrl('')).toBe(false);
    expect(isSpotifyUrl(null)).toBe(false);
    expect(isYouTubeUrl(undefined)).toBe(false);
  });
});
