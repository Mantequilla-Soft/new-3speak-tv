/**
 * Scheduling Helpers for 3Speak Video Posts
 * Utilities for managing scheduled post functionality
 */

/**
 * Format JavaScript Date for HTML5 datetime-local input
 * @param {Date} date - JavaScript Date object
 * @returns {string} - Format: "YYYY-MM-DDTHH:MM"
 */
export function formatDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Calculate minimum and maximum date constraints for scheduling
 * @returns {Object} - { minDate: Date, maxDate: Date, minFormatted: string, maxFormatted: string }
 */
export function getMinMaxDates() {
  const now = Date.now();
  const minDate = new Date(now + 15 * 60 * 1000); // +15 minutes
  const maxDate = new Date(now + 90 * 24 * 60 * 60 * 1000); // +90 days
  
  return {
    minDate,
    maxDate,
    minFormatted: formatDateTimeLocal(minDate),
    maxFormatted: formatDateTimeLocal(maxDate)
  };
}

/**
 * Get scheduling parameters for API submission
 * @param {boolean} isScheduled - Whether scheduling is enabled
 * @param {string} datetimeValue - Value from datetime-local input
 * @returns {Object} - { publish_type: 'publish'|'schedule', publish_data?: number }
 */
export function getSchedulingParams(isScheduled, datetimeValue) {
  // Not scheduling - immediate publish
  if (!isScheduled) {
    return { publish_type: 'publish' };
  }

  // Fallback if no datetime selected
  if (!datetimeValue) {
    console.warn('Schedule enabled but no datetime selected, falling back to publish');
    return { publish_type: 'publish' };
  }

  // Convert to Unix timestamp (seconds)
  // datetimeValue is "YYYY-MM-DDTHH:MM" with no timezone — JS parses as local time
  // .getTime() returns UTC milliseconds, /1000 gives correct UTC seconds
  const scheduledDate = new Date(datetimeValue);
  const publish_data = Math.floor(scheduledDate.getTime() / 1000);
  const nowUnix = Math.floor(Date.now() / 1000);

  // An unparseable value gives NaN, which slips past the `<= now` check below.
  if (!Number.isFinite(publish_data)) {
    console.warn(`Scheduled time "${datetimeValue}" is not a valid date, rejecting`);
    return { publish_type: 'error', error: 'Scheduled time is not a valid date' };
  }

  if (publish_data <= nowUnix) {
    console.warn(`Scheduled time is in the past (${publish_data} <= ${nowUnix}), rejecting`);
    return { publish_type: 'error', error: 'Scheduled time is in the past' };
  }

  console.log(`Scheduling: local="${datetimeValue}" → UTC unix=${publish_data} (${new Date(publish_data * 1000).toISOString()})`);

  return {
    publish_type: 'schedule',
    publish_data: publish_data
  };
}

/**
 * Format a date for display in user-friendly format
 * @param {string} datetimeValue - Value from datetime-local input
 * @returns {string} - Formatted date string (e.g., "Jan 5, 2026 at 2:30 PM")
 */
export function formatScheduledDateDisplay(datetimeValue) {
  if (!datetimeValue) return '';
  
  const date = new Date(datetimeValue);
  const options = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  };
  
  return date.toLocaleString('en-US', options);
}
