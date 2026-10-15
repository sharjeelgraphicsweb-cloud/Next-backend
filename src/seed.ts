import { Document, Filter, ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { env } from './config/env';
import { hashPassword } from './data/auth';
import { collection, RawMongoDocument } from './data/mongo';

async function seedIfMissing(
  name: string,
  id: ObjectId,
  filter: Filter<RawMongoDocument>,
  data: Document,
): Promise<RawMongoDocument & { _id: ObjectId | string }> {
  const records = collection(name);
  await records.updateOne(filter, { $setOnInsert: { _id: id, ...data } }, { upsert: true });
  const record = await records.findOne(filter);
  if (!record || record._id === undefined) {
    throw new Error(`Could not create or load the demo record in ${name}.`);
  }
  return record;
}

async function seedDemoData(): Promise<void> {
  const now = new Date();
  const learnerId = new ObjectId('671000000000000000000001');
  const learnerEmail = 'demo.learner@nextstep.local';
  const learner = await seedIfMissing('users', learnerId, { email: learnerEmail }, {
    name: 'Demo Learner',
    email: learnerEmail,
    password: await hashPassword('DemoPass123!'),
    role: 'user',
    avatar: null,
    domain: 'Web Development',
    skills: ['HTML', 'CSS', 'JavaScript'],
    location: null,
    created_at: now,
    updated_at: now,
  });
  const userId = learner._id.toString();

  const courseId = new ObjectId('671000000000000000000002');
  const secondCourseId = new ObjectId('671000000000000000000003');
  const course = await seedIfMissing('courses', courseId, { title: 'Web Development Foundations' }, {
    title: 'Web Development Foundations',
    description: 'Build a strong foundation in semantic HTML, modern CSS, and JavaScript.',
    instructor: 'NextStep Learning Team',
    category: 'Web Development',
    level: 'Beginner',
    duration: '6 weeks',
    price: 0,
    image: null,
    is_published: true,
    created_at: now,
    updated_at: now,
  });
  const secondCourse = await seedIfMissing('courses', secondCourseId, { title: 'Building APIs with Node.js' }, {
    title: 'Building APIs with Node.js',
    description: 'Learn how to build and test REST APIs with Node.js and Express.',
    instructor: 'NextStep Learning Team',
    category: 'Backend Development',
    level: 'Intermediate',
    duration: '4 weeks',
    price: 0,
    image: null,
    is_published: true,
    created_at: now,
    updated_at: now,
  });
  const courseIdString = course._id.toString();
  const secondCourseIdString = secondCourse._id.toString();

  const lessons = [
    {
      _id: new ObjectId('671000000000000000000011'),
      course_id: courseIdString,
      title: 'Writing accessible HTML',
      description: 'Create a semantic page structure with accessible landmarks.',
      content: 'Practice headings, links, forms, and semantic HTML elements.',
      video_url: 'https://www.youtube.com/watch?v=qz0aCZ1Y6EA',
      duration: 35,
      order: 1,
      is_published: true,
    },
    {
      _id: new ObjectId('671000000000000000000012'),
      course_id: courseIdString,
      title: 'Responsive layouts with CSS',
      description: 'Use modern CSS layout tools to build responsive pages.',
      content: 'Practice Flexbox, Grid, spacing, and responsive breakpoints.',
      video_url: 'https://www.youtube.com/watch?v=1Rs2ND1ryYc',
      duration: 45,
      order: 2,
      is_published: true,
    },
    {
      _id: new ObjectId('671000000000000000000013'),
      course_id: secondCourseIdString,
      title: 'Your first Express API',
      description: 'Create a small JSON API using Express.',
      content: 'Practice routes, request validation, and JSON responses.',
      video_url: 'https://www.youtube.com/watch?v=Oe421EPjeBE',
      duration: 40,
      order: 1,
      is_published: true,
    },
  ];
  for (const { _id, ...lesson } of lessons) {
    await seedIfMissing('lessons', _id, {
      course_id: lesson.course_id,
      title: lesson.title,
    }, { ...lesson, created_at: now, updated_at: now });
  }

  const roadmap = await seedIfMissing('roadmaps', new ObjectId('671000000000000000000021'), {
    user_id: userId,
    target_role: 'Frontend Developer',
  }, {
    user_id: userId,
    target_role: 'Frontend Developer',
    description: 'A practical learning path from web fundamentals to a portfolio project.',
    current_skills: ['HTML'],
    skill_gaps: ['CSS', 'JavaScript', 'React'],
    language: 'English',
    nodes: [
      {
        id: 1,
        skill_name: 'HTML',
        title: 'Build accessible web pages',
        description: 'Practice semantic structure, forms, and accessibility.',
        estimated_time: '1 week',
        level: 'Beginner',
        resources: [{ title: 'HTML basics', url: 'https://developer.mozilla.org/en-US/docs/Learn/HTML' }],
        completed: true,
        order: 1,
      },
      {
        id: 2,
        skill_name: 'CSS',
        title: 'Style responsive interfaces',
        description: 'Learn layout, typography, and responsive design.',
        estimated_time: '2 weeks',
        level: 'Beginner',
        resources: [{ title: 'CSS basics', url: 'https://developer.mozilla.org/en-US/docs/Learn/CSS' }],
        completed: false,
        order: 2,
      },
      {
        id: 3,
        skill_name: 'JavaScript',
        title: 'Add interactivity',
        description: 'Use JavaScript to build interactive browser experiences.',
        estimated_time: '3 weeks',
        level: 'Beginner',
        resources: [{ title: 'JavaScript guide', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide' }],
        completed: false,
        order: 3,
      },
    ],
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  const roadmapIdString = roadmap._id.toString();

  const quizVideoId = 'demo-html-semantics';
  await seedIfMissing('progress', new ObjectId('671000000000000000000022'), {
    user_id: userId,
    roadmap_id: roadmapIdString,
  }, {
    user_id: userId,
    roadmap_id: roadmapIdString,
    completed_nodes: ['1'],
    videos_watched: [quizVideoId],
    passed_quizzes: [],
    node_activity: [
      {
        node_id: '1',
        skill_name: 'HTML',
        title: 'Build accessible web pages',
        completed_at: now.toISOString(),
      },
    ],
    practice_tasks: [
      {
        task_id: 'task-1',
        node_id: '1',
        skill_name: 'HTML',
        title: 'Build a semantic profile page',
        deliverable: 'Create a small profile page using semantic HTML elements.',
        revision_step: 'Review the page structure and explain your accessibility choices.',
        completed: true,
        completed_at: now,
        portfolio_url: null,
        submission_notes: 'Demo practice task completed.',
        submission_file_url: null,
        mentor_review_status: 'not_submitted',
        mentor_feedback: null,
      },
    ],
    status: 'in_progress',
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now,
  });

  await seedIfMissing('user_stats', new ObjectId('671000000000000000000023'), { user_id: userId }, {
    user_id: userId,
    xp: 120,
    level: 2,
    streak: 3,
    last_active: now,
    badges: ['First Steps'],
  });

  await seedIfMissing('quizzes', new ObjectId('671000000000000000000024'), { video_id: quizVideoId }, {
    video_id: quizVideoId,
    video_title: 'HTML semantics for beginners',
    skill_name: 'HTML',
    questions: [
      {
        question: 'Which element represents the main content of a page?',
        options: ['<main>', '<aside>', '<footer>', '<label>'],
        correct_answer: '<main>',
        explanation: 'The main element identifies the dominant content of the document.',
      },
      {
        question: 'Which attribute provides alternative text for an image?',
        options: ['title', 'alt', 'name', 'role'],
        correct_answer: 'alt',
        explanation: 'The alt attribute provides a text alternative for an image.',
      },
    ],
    created_at: now,
    updated_at: now,
  });

  console.info('Demo data is ready.');
  console.info(`Demo login: ${learnerEmail} / DemoPass123!`);
  console.info('Seeded or verified sample learner, courses, lessons, roadmap, progress, stats, and quiz.');
}

async function main(): Promise<void> {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI must be configured before seeding demo data.');
  }

  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.DB_DATABASE || undefined,
    serverSelectionTimeoutMS: 5000,
  });

  try {
    await seedDemoData();
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Failed to seed demo data.', error);
  process.exitCode = 1;
});