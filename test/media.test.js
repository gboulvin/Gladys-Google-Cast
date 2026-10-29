import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_PLAYBACK_STATE } from '@gladysassistant/integration-sdk';
import {
  assertMediaUrl,
  buildMediaInfo,
  guessContentType,
  readMetadata,
  toPlaybackState,
} from '../src/cast/media.js';

test('the content type is guessed from the extension, MP3 otherwise', () => {
  assert.equal(guessContentType('http://nas/a/song.FLAC?x=1'), 'audio/flac');
  assert.equal(guessContentType('https://cdn/live.m3u8'), 'application/x-mpegURL');
  assert.equal(guessContentType('http://192.168.1.2:1443/api/v1/tts/audio/abc'), 'audio/mpeg');
  assert.equal(guessContentType('not a url'), 'audio/mpeg');
});

test('the LOAD media carries the URL, type, stream type and title', () => {
  assert.deepEqual(buildMediaInfo({ url: 'http://x/cam.jpg', title: 'Door', live: false }), {
    contentId: 'http://x/cam.jpg',
    contentUrl: 'http://x/cam.jpg',
    contentType: 'image/jpeg',
    streamType: 'BUFFERED',
    metadata: { metadataType: 0, title: 'Door', images: [] },
  });
  const radio = buildMediaInfo({ url: 'http://x/radio', contentType: 'audio/aac', live: true });
  assert.equal(radio.contentType, 'audio/aac');
  assert.equal(radio.streamType, 'LIVE');
  assert.equal(radio.metadata.title, 'Gladys Assistant');
});

test('media URLs must be http(s)', () => {
  assert.equal(assertMediaUrl(' https://x/a.mp3 '), 'https://x/a.mp3');
  assert.throws(() => assertMediaUrl('file:///etc/passwd'), /http/);
  assert.throws(() => assertMediaUrl('nope'), /Invalid/);
  assert.throws(() => assertMediaUrl(''), /required/);
  assert.throws(() => assertMediaUrl(1), /required/);
});

test('Cast player states map to the Gladys playback states', () => {
  assert.equal(toPlaybackState('PLAYING'), MUSIC_PLAYBACK_STATE.PLAYING);
  assert.equal(toPlaybackState('PAUSED'), MUSIC_PLAYBACK_STATE.PAUSED);
  assert.equal(toPlaybackState('BUFFERING'), MUSIC_PLAYBACK_STATE.BUFFERING);
  assert.equal(toPlaybackState('IDLE'), MUSIC_PLAYBACK_STATE.IDLE);
  assert.equal(toPlaybackState(undefined), MUSIC_PLAYBACK_STATE.IDLE);
});

test('metadata of every kind reads as title / artist / album / artwork', () => {
  assert.deepEqual(
    readMetadata({
      metadataType: 3,
      title: 'Blue in Green',
      artist: 'Miles Davis',
      albumName: 'Kind of Blue',
      images: [{ url: 'https://i.scdn.co/image/1' }, { url: 'https://i.scdn.co/image/2' }],
    }),
    {
      title: 'Blue in Green',
      artist: 'Miles Davis',
      album: 'Kind of Blue',
      artworkUrl: 'https://i.scdn.co/image/1',
    },
  );
  assert.deepEqual(
    readMetadata({ title: 'Episode 4', seriesTitle: 'Show', images: [{ url: 'data:x' }] }),
    {
      title: 'Episode 4',
      artist: 'Show',
      album: '',
      artworkUrl: null,
    },
  );
  assert.deepEqual(readMetadata(undefined), { title: '', artist: '', album: '', artworkUrl: null });
});
