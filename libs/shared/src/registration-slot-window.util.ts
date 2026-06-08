const REGISTRATION_TIME_ZONE = 'Asia/Bangkok';

export type RegistrationSlotWindow = {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
};

export type LocalDateTimeParts = {
  date: string;
  time: string;
};

export function getRegistrationLocalDateTimeParts(
  date: Date,
): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REGISTRATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    date: `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`,
    time: `${byType.get('hour')}:${byType.get('minute')}`,
  };
}

export function registrationLocalDateTimeToDate(date: string, time: string) {
  return new Date(`${date}T${time}:00+07:00`);
}

export function addRegistrationLocalDays(date: string, days: number) {
  const value = registrationLocalDateTimeToDate(date, '00:00');
  value.setUTCDate(value.getUTCDate() + days);
  return getRegistrationLocalDateTimeParts(value).date;
}

export function isRegistrationSlotActiveAt(
  slot: RegistrationSlotWindow,
  at = new Date(),
) {
  const parts = getRegistrationLocalDateTimeParts(at);
  return (
    parts.date >= slot.startDate &&
    parts.date <= slot.endDate &&
    parts.time >= slot.startTime &&
    parts.time <= slot.endTime
  );
}

export function getRegistrationSlotNextOpenAt(
  slot: RegistrationSlotWindow,
  at = new Date(),
) {
  const parts = getRegistrationLocalDateTimeParts(at);

  if (parts.date < slot.startDate) {
    return registrationLocalDateTimeToDate(slot.startDate, slot.startTime);
  }

  if (parts.date > slot.endDate) {
    return null;
  }

  if (parts.time < slot.startTime) {
    return registrationLocalDateTimeToDate(parts.date, slot.startTime);
  }

  if (parts.time <= slot.endTime) {
    return registrationLocalDateTimeToDate(parts.date, slot.startTime);
  }

  const nextDate = addRegistrationLocalDays(parts.date, 1);
  if (nextDate <= slot.endDate) {
    return registrationLocalDateTimeToDate(nextDate, slot.startTime);
  }

  return null;
}

export function getRegistrationSlotEffectiveCloseAt(
  slot: RegistrationSlotWindow,
  at = new Date(),
) {
  const nextOpenAt = getRegistrationSlotNextOpenAt(slot, at);
  if (!nextOpenAt) return null;

  const nextParts = getRegistrationLocalDateTimeParts(nextOpenAt);
  return registrationLocalDateTimeToDate(nextParts.date, slot.endTime);
}

export function isRegistrationSlotOutsideCurrentWindow(
  slot: RegistrationSlotWindow,
  at = new Date(),
) {
  if (isRegistrationSlotActiveAt(slot, at)) return false;

  const parts = getRegistrationLocalDateTimeParts(at);
  if (parts.date < slot.startDate) return false;
  if (parts.date > slot.endDate) return true;

  return parts.time > slot.endTime;
}
