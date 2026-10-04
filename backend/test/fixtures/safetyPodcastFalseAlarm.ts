/**
 * Tonight's false alarm (Oct 3, 2026, 7:04 PM CT, Jettx): a worker filmed a
 * desk while a YouTube podcast (Shawn Ryan on The Diary Of A CEO) played on
 * a Dell monitor. The word list matched "fighting" at 0:51 and a critical
 * "Possible physical violence" email went out at 7:07 PM. Text copied from
 * the stored transcript and vision narration (read-only).
 */
export const PODCAST_TRANSCRIPT = [
  "[0:00] But that's the end of it. That was my last deployment.",
  '[0:03] When you came back from the SEAL team, were you a different man?',
  '[0:06] Definitely.',
  '[0:07] In what way were you changed?',
  '[0:10] A lot of ways. You learn a lot of critical life lessons in the SEAL teams and being in environments.',
  '[0:51] The shock and a dosh of that, which is a lot of the tracking and fighting of all of those things.',
  "[0:57] So you're in Navy sales. You contract with the CIA for a while.",
  '[1:04] And then I guess the other pretty tremendous accomplishment is you now have built one of the biggest podcasts on planet Earth, where you interview people just like I do here.',
  "[1:11] That's correct.",
  '[1:13] Do you think podcasters are being compromised by sort of guests being planted?',
  '[1:17] Yes. I have no proof, but yes, in a couple of different ways.',
  "[1:24] So here's one example, but not just podcasts. Let's go influencers, not just podcasters.",
].join('\n');

export const PODCAST_SEGMENTS = PODCAST_TRANSCRIPT.split('\n').map((line, i, all) => {
  const m = line.match(/^\[(\d+):(\d{2})\]\s*(.*)$/)!;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const next = all[i + 1]?.match(/^\[(\d+):(\d{2})\]/);
  const end = next ? Number(next[1]) * 60 + Number(next[2]) : start + 6;
  return { start, end, text: m[3]! };
});

export const PODCAST_NARRATION =
  'Handheld vertical phone footage shot entirely in what appears to be a finished/unfinished basement that doubles as a home office and workshop. ' +
  'Opens at ~1s with the camera low over a dark red-brown wooden desktop: an Apple Magic Keyboard in the foreground. ' +
  'By 8s the camera lifts to frame a Dell monitor on the desk; on screen is YouTube (Premium logo visible) playing "Shawn Ryan: There\'s A Battle For Your Soul, It\'s Happening Right Now" from The Diary Of A CEO channel, with a dark-shirted host speaking in front of bookshelves. ' +
  'A phone lying on the desk shows 7:04.';
