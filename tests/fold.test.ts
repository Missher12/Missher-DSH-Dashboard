import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldSession, readTicket, statusOf, tokenTotal, type LogEvent } from '../src/fold.ts'
import { allowedRequest } from '../src/index.ts'
const epoch = Date.parse('2026-11-08T01:00:00Z')
const header = { id: 'session-test', createdAt: epoch }
const event = (seq: number, type: string, data: any, time = epoch + seq * 1000): LogEvent => ({ seq, type, data, time })
const usage = { inputTokens: 30, outputTokens: 5, cacheReadTokens: 60, cacheWriteTokens: 5 }
const message = (seq: number, value: any = usage, step = 0) => event(seq, 'assistant/message', { turn: 0, step, usage: value, stream: [] })
const goal = { id: 'g1', objective: 'Ship a verified feature', phase: 'active', maxGoalRounds: 10 }
test('deduplicates settled attempt/message usage, counts billed retries independently', () => {
  const attempt = event(0, 'assistant/attempt', { turn: 0, step: 0, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] })
  const row = foldSession(header, [attempt, message(1), event(2, 'llm/retry-started', { turn: 0, step: 0 }), message(3)], 'Asia/Shanghai')
  assert.equal(tokenTotal(row.lifetime.tokens), 200)
  assert.equal(row.lifetime.reported, 2)
  assert.deepEqual(row.lifetime.tokens, { uncachedInput: 60, output: 10, cacheRead: 120, cacheWrite: 10 })
})
test('fork usage and inherited goals/checklists are not counted again', () => {
  const row = foldSession({ ...header, isSeeded: true, parentSession: 'parent' }, [
    event(0, 'session/title', { title: 'Inherited title' }), event(1, 'goal/change', { operation: 'create', goal }),
    event(2, 'todo/write', { todos: [{ content: 'Parent item', status: 'completed' }] }), message(3), message(4),
  ], 'Asia/Shanghai', 4)
  assert.equal(tokenTotal(row.lifetime.tokens), 100)
  assert.equal(row.title, 'Inherited title')
  assert.equal(row.goal, undefined)
  assert.equal(row.todos, null)
})
test('missing and invalid usage are skipped while valid usage is counted', () => {
  const row = foldSession(header, [message(0, undefined), message(1, { inputTokens: -1, outputTokens: 2 }, 1), message(2, { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 }, 2)], 'Asia/Shanghai')
  // Explicitly absent usage is a separate request; no made-up zero-cost sample.
  const absent = foldSession(header, [event(0, 'assistant/message', { turn: 0, step: 0, stream: [] })], 'Asia/Shanghai')
  assert.equal(absent.lifetime.missing, 1)
  assert.equal(absent.lifetime.reported, 0)
  assert.equal(tokenTotal(absent.lifetime.tokens), 0)
  assert.equal(row.lifetime.missing, 2)
  assert.equal(row.lifetime.reported, 1)
  assert.equal(tokenTotal(row.lifetime.tokens), 100)
})
test('local calendar midnight uses the configured time zone', () => {
  const row = foldSession(header, [
    { ...message(0), time: Date.parse('2026-11-07T15:59:00Z') },
    { ...message(1, usage, 1), time: Date.parse('2026-11-07T16:00:00Z') },
  ], 'Asia/Shanghai')
  assert.deepEqual(Object.keys(row.hours), ['2026-11-07T23', '2026-11-08T00'])
  assert.equal(tokenTotal(row.hours['2026-11-08T00'].tokens), 100)
})
test('idle and a completed model turn never imply a completed goal', () => {
  const row = foldSession(header, [event(0, 'goal/change', { operation: 'create', goal }), event(1, 'turn/end', { turn: 0, reason: { kind: 'completed' } })], 'UTC')
  assert.equal(statusOf(row, false), 'idle')
  assert.equal(statusOf(row, true), 'running')
  assert.equal(row.goal?.phase, 'active')
})
test('goal lifecycle tracks continuations and clear tombstones', () => {
  const events = [event(0, 'goal/change', { operation: 'create', goal, roundsStarted: 0 }), event(1, 'user/message', { source: { kind: 'goal', goalId: 'g1', round: 3 } })]
  assert.equal(foldSession(header, events, 'UTC').goal?.rounds, 3)
  assert.equal(foldSession(header, [...events, event(2, 'goal/change', { operation: 'clear' })], 'UTC').goal, undefined)
  const complete = foldSession(header, [...events, event(2, 'goal/change', { operation: 'complete', goal: { ...goal, phase: 'complete' } })], 'UTC')
  assert.equal(statusOf(complete, false), 'complete')
})
test('pending approvals and tools clear on settlement and turn end', () => {
  const events = [event(0, 'turn/start', { turn: 0 }), event(1, 'tool/call', { callId: 'c', name: 'bash' }), event(2, 'approval/asked', { id: 'a', toolName: 'bash' })]
  assert.equal(statusOf(foldSession(header, events, 'UTC'), true), 'approval')
  const settled = foldSession(header, [...events, event(3, 'approval/decided', { id: 'a', outcome: 'allowed-once' }), event(4, 'tool/result', { message: { toolCallId: 'c' } })], 'UTC')
  assert.equal(settled.approvals, 0); assert.deepEqual(settled.pendingTools, [])
  const ended = foldSession(header, [...events, event(3, 'turn/end', { turn: 0, reason: { kind: 'aborted' } })], 'UTC')
  assert.equal(ended.approvals, 0); assert.deepEqual(ended.pendingTools, [])
})
test('stopped Superagent tickets are not successful completions; queued work remains visible', () => {
  const row = foldSession(header, [], 'UTC'), ticket = readTicket({ id: 't', title: 'Task', stage: 'ended', ended: { outcome: 'stopped' } })!
  assert.equal(statusOf(row, false, ticket), 'stopped')
  assert.equal(statusOf(row, false, { ...ticket, outcome: 'completed' }), 'complete')
  assert.equal(statusOf(row, false, { ...ticket, stage: 'working', action: 'queued' }), 'queued')
  assert.equal(statusOf(row, false, { ...ticket, stage: 'person', action: 'review' }), 'attention')
})
test('dashboard endpoint requires its same-origin header and a loopback Host', () => {
  assert.equal(allowedRequest({ headers: { host: '127.0.0.1:5000', 'x-dsh-dashboard': '1' } }, 5000), true)
  assert.equal(allowedRequest({ headers: { host: '127.0.0.1:5000' } }, 5000), false)
  assert.equal(allowedRequest({ headers: { host: '127.0.0.1:5000', 'x-dsh-dashboard': '1', origin: 'https://example.com' } }, 5000), false)
  assert.equal(allowedRequest({ headers: { host: 'attacker.example:5000', 'x-dsh-dashboard': '1' } }, 5000), false)
})
