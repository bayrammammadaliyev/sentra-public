// Topic bank for the write page. Used by the server (routes/grade.js checks
// custom-topic length) and by the page (served as /lib/topics.js by server.js,
// so both always use this one list).
const TOPICS = [
  { id: 1, text: "Should school uniforms be required for all students?" },
  { id: 2, text: "Should students be allowed to use mobile phones at school?" },
  { id: 3, text: "Is online learning as effective as learning in a classroom?" },
  { id: 4, text: "Should homework be banned?" },
  { id: 5, text: "Is it better to live in a city or in a village?" },
  { id: 6, text: "Does social media do more harm than good to teenagers?" },
  { id: 7, text: "Should public transport be free?" },
  { id: 8, text: "Is it better to study alone or in a group?" },
  { id: 9, text: "Should children get pocket money from their parents?" },
  { id: 10, text: "Should every student learn a musical instrument at school?" },
  { id: 11, text: "Is it better to work for a company or to start your own business?" },
  { id: 12, text: "Should students choose all their school subjects themselves?" },
];

// "Öz mövzunuz": a custom topic, same upper bound as the teacher app's prompt.
const MAX_TOPIC_CHARS = 1000;
// Same upper bound as the teacher app's essay.
const MAX_ESSAY_CHARS = 5000;

module.exports = { TOPICS, MAX_TOPIC_CHARS, MAX_ESSAY_CHARS };
