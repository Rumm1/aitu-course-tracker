import test from 'node:test';
import assert from 'node:assert/strict';
import {validExtensionPayload} from '../src/extension-client.js';
test('extension protocol accepts only explicit bounded progress records',()=>{
 const payload={version:1,enabled:true,capturedAt:'2026-11-07T12:00:00Z',rows:[{courseId:'Q2',status:'active',percent:67}]};
 assert.equal(validExtensionPayload(payload),true);
 assert.equal(validExtensionPayload({...payload,enabled:'true'}),false);
 assert.equal(validExtensionPayload({...payload,rows:[{courseId:'Q2',status:'active',percent:101}]}),false);
 assert.equal(validExtensionPayload({...payload,rows:[{courseId:'Q2',status:'active',completedTasks:8,totalTasks:3}]}),false);
 assert.equal(validExtensionPayload({...payload,capturedAt:'yesterday'}),false);
 assert.equal(validExtensionPayload({...payload,rows:[{courseId:'Q2',status:'done',percent:100}]}),true);
});
