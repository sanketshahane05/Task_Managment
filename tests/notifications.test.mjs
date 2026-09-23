import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotifications } from '../src/lib/notifications.ts';
const now = new Date(2026, 8, 11, 12);
const task = { id:'t', title:'Task', projectId:'p', assigneeId:'employee', createdById:'senior', parentId:'parent', status:'In progress', dueDate:'2026-09-11', assignedAt:now.toISOString() };
const worker = {id:'employee',role:'Employee'};
test('local calendar dates distinguish overdue, today and approaching deadlines', () => {
  const alerts = buildNotifications(['2026-09-10','2026-09-11','2026-09-14','2026-09-15'].map((dueDate,i)=>({...task,id:String(i),dueDate})),[],worker,now).filter(a=>a.kind==='Deadlines');
  assert.deepEqual(alerts.map(a=>a.label),['Overdue','Due today','Due in the next 3 days']);
});
test('context-only parents do not create employee assignment, deadline or review alerts', () => {
  assert.equal(buildNotifications([{...task,assigneeId:'someone',reviewState:'pending'}],[],worker,now).length,0);
});
test('senior reviews own delegated subtasks but cannot review own assigned work', () => {
  const tasks=[{...task,reviewState:'pending'},{...task,id:'self',assigneeId:'senior',reviewState:'pending'},{...task,id:'other',createdById:'other',reviewState:'pending'}];
  assert.deepEqual(buildNotifications(tasks,[],{id:'senior',role:'Senior Employee'},now).filter(a=>a.kind==='Reviews').map(a=>a.taskId),['t']);
});
test('every assigned employee receives task notifications', () => {
  const shared={...task,assigneeId:'employee',assigneeIds:['employee','coworker']};
  assert.ok(buildNotifications([shared],[],{id:'coworker',role:'Employee'},now).some(item=>item.taskId==='t'));
});
test('read messages, own messages and inaccessible tasks never generate message alerts', () => {
  const notes=[{taskId:'t',authorId:'other',createdAt:now.toISOString(),readBy:['employee']},{taskId:'t',authorId:'employee',createdAt:now.toISOString()},{taskId:'hidden',authorId:'other',createdAt:now.toISOString()}];
  assert.equal(buildNotifications([task],notes,worker,now).filter(a=>a.kind==='Messages').length,0);
  notes.push({taskId:'t',authorId:'other',createdAt:now.toISOString()});
  assert.equal(buildNotifications([task],notes,worker,now).find(a=>a.kind==='Messages').label,'1 unread message');
});
test('completed and archived tasks stop work alerts; completed tasks retain unread chats', () => {
  const notes=[{taskId:'t',authorId:'other',createdAt:now.toISOString()}];
  assert.deepEqual(buildNotifications([{...task,status:'Completed'}],notes,worker,now).map(a=>a.kind),['Messages']);
  assert.deepEqual(buildNotifications([{...task,archivedAt:now.toISOString()}],notes,worker,now),[]);
});
test('assignments older than seven days and future dates are excluded', () => {
  assert.equal(buildNotifications([{...task,dueDate:undefined,assignedAt:'2026-08-01T00:00:00Z'},{...task,id:'future',dueDate:undefined,assignedAt:'2027-01-01T00:00:00Z'}],[],worker,now).length,0);
});

