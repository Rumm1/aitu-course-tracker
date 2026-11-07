import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_TRACKER_URL,resolveTrackerURL,trackerExtensionScope} from '../scripts/tracker-url.mjs';

test('tracker builds use a repository-specific Pages address and stable local fallback',()=>{
  assert.equal(resolveTrackerURL(),DEFAULT_TRACKER_URL);
  assert.equal(resolveTrackerURL({GITHUB_REPOSITORY:'Friend/my-courses'}),'https://friend.github.io/my-courses/');
  assert.equal(resolveTrackerURL({GITHUB_REPOSITORY:'Friend/Friend.github.io'}),'https://friend.github.io/');
  assert.equal(resolveTrackerURL({GITHUB_REPOSITORY:'Friend/another.github.io'}),'https://friend.github.io/another.github.io/');
  assert.equal(resolveTrackerURL({GITHUB_REPOSITORY:'Rumm1/aitu-course-tracker'}),DEFAULT_TRACKER_URL);
});

test('an explicit valid HTTPS base URL takes priority and receives a trailing slash',()=>{
  assert.equal(resolveTrackerURL({TRACKER_URL:'https://learning.example/my-space',GITHUB_REPOSITORY:'Friend/my-courses'}),'https://learning.example/my-space/');
  assert.equal(resolveTrackerURL({TRACKER_URL:' https://LEARNING.example/ '}),'https://learning.example/');
  assert.equal(resolveTrackerURL({TRACKER_URL:'',GITHUB_REPOSITORY:'Friend/my-courses'}),'https://friend.github.io/my-courses/');
});

test('invalid addresses cannot widen extension scope or include credentials',()=>{
  for(const TRACKER_URL of ['http://example.com/','javascript:alert(1)','https://user:pass@example.com/site/','https://example.com/site/?token=x','https://example.com/site/#courses','https://example.com/site/?','https://example.com/site/#','https://example.com/*','https://example.com/site%2fother/','https://example.com/site//other/','https://example.com/private/../','https://example.com/private/%2e%2e/'])assert.throws(()=>resolveTrackerURL({TRACKER_URL}),TRACKER_URL);
  for(const GITHUB_REPOSITORY of ['owner','owner/repo/extra','owner/repo name','-owner/repo','owner/..'])assert.throws(()=>resolveTrackerURL({GITHUB_REPOSITORY}),GITHUB_REPOSITORY);
});

test('manifest scope and runtime scope share the exact personal site URL',()=>{
  assert.deepEqual(trackerExtensionScope('https://friend.github.io/my-courses/'),{url:'https://friend.github.io/my-courses/',origin:'https://friend.github.io',path:'/my-courses/',matches:['https://friend.github.io/*'],includeGlobs:['https://friend.github.io/my-courses/*']});
  assert.deepEqual(trackerExtensionScope('https://friend.github.io/').includeGlobs,['https://friend.github.io/*']);
  const custom=trackerExtensionScope('https://learning.example/private/tracker/');
  assert.equal(custom.origin,'https://learning.example');assert.equal(custom.path,'/private/tracker/');
  assert.deepEqual(custom.matches,['https://learning.example/*']);assert.deepEqual(custom.includeGlobs,['https://learning.example/private/tracker/*']);
});
