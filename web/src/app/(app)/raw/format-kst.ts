// KST 표시 포맷터.
//
// DB 는 UTC 로 저장하지만 화면은 한국 사용자 기준이라 Asia/Seoul 로
// 변환해서 보여준다 (AGENTS.md 코딩 규칙: "날짜는 DB에 UTC로 저장하고
// 표시할 때 KST로 변환").
const formatter = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatKst(date: Date): string {
  return formatter.format(date);
}
