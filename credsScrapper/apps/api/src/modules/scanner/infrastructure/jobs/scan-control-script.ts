// A single Redis key is the linearization point for admission and Stop.
// No TTL and no implicit initialization: loss of this key must fail closed.
export const SCAN_CONTROL_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return redis.error_reply('scan_control_unavailable') end
local ok, control = pcall(cjson.decode, raw)
if not ok or type(control) ~= 'table' then return redis.error_reply('scan_control_unavailable') end
local epoch = control.epoch
local stopEpoch = control.stopEpoch
local state = control.state
local function validDate(value)
  if value == cjson.null then return true end
  if type(value) ~= 'string' then return false end
  local year, month, day, hour, minute, second = string.match(value,
    '^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)%.%d%d%dZ$')
  if not year then return false end
  year, month, day = tonumber(year), tonumber(month), tonumber(day)
  hour, minute, second = tonumber(hour), tonumber(minute), tonumber(second)
  if month < 1 or month > 12 or hour > 23 or minute > 59 or second > 59 then return false end
  local days = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
  if month == 2 and year % 4 == 0 and (year % 100 ~= 0 or year % 400 == 0) then days[2] = 29 end
  return day >= 1 and day <= days[month]
end
if type(epoch) ~= 'number' or epoch < 0 or epoch > 9007199254740990 or epoch % 1 ~= 0
  or (state ~= 'ready' and state ~= 'stopping' and state ~= 'stopped')
  or (stopEpoch ~= cjson.null and (type(stopEpoch) ~= 'number' or stopEpoch < 1 or stopEpoch > epoch or stopEpoch % 1 ~= 0))
  or not validDate(control.requestedAt)
  or not validDate(control.finishedAt)
  or (state == 'ready' and ((stopEpoch == cjson.null and (control.requestedAt ~= cjson.null or control.finishedAt ~= cjson.null)) or (stopEpoch ~= cjson.null and (control.requestedAt == cjson.null or control.finishedAt == cjson.null))))
  or (state == 'stopping' and (stopEpoch ~= epoch or control.requestedAt == cjson.null or control.finishedAt ~= cjson.null))
  or (state == 'stopped' and (stopEpoch ~= epoch or control.requestedAt == cjson.null or control.finishedAt == cjson.null)) then
  return redis.error_reply('scan_control_unavailable')
end
if ARGV[1] == 'admit' then
  if state == 'stopping' then return redis.error_reply('scan_stopping') end
  if state == 'stopped' then
    control.state = 'ready'
    redis.call('SET', KEYS[1], cjson.encode(control))
  end
  return tostring(epoch)
elseif ARGV[1] == 'stop' then
  if state == 'ready' then
    if epoch >= 9007199254740990 then return redis.error_reply('scan_control_unavailable') end
    control.epoch = epoch + 1
    control.state = 'stopping'
    control.stopEpoch = control.epoch
    control.requestedAt = ARGV[2]
    control.finishedAt = cjson.null
    redis.call('SET', KEYS[1], cjson.encode(control))
  end
  return cjson.encode(control)
elseif ARGV[1] == 'finish' then
  if state == 'stopping' and tonumber(ARGV[2]) == epoch then
    control.state = 'stopped'
    control.finishedAt = ARGV[3]
    redis.call('SET', KEYS[1], cjson.encode(control))
    return 1
  end
  return 0
end
return redis.error_reply('scan_control_unavailable')
`;
