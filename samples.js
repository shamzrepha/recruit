/* Sample role and four made-up candidates, so the demo works with one click. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Samples = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var JOB = [
    'Founding Backend Engineer, seed-stage fintech startup (remote)',
    '',
    'Requirements',
    '- 3+ years building backend services',
    '- Python or Go in production',
    '- PostgreSQL or a similar database',
    '- Shipped an API used by real customers',
    '',
    'Nice to have',
    '- Has worked at an early-stage startup',
    '- AWS or GCP experience'
  ].join('\n');

  var CANDIDATES = [
    {
      name: 'Adaeze Okafor',
      phone: '+2348031234567',
      email: 'adaeze.okafor@example.com',
      consent: true,
      rankingPercentile: 'Top 5%',
      interviewSummary: 'Candidate confirmed 5 years total backend engineering, specifically architecting payments APIs on FastAPI with PostgreSQL. Handled 2M req/day peak throughput.',
      interviewConfidence: 'high',
      interviewTranscript: [
        { role: 'ai', text: 'Could you elaborate on the scale of the payments API you shipped at your previous startup?' },
        { role: 'candidate', text: 'We handled roughly 2M requests a day across 40 active fintech merchants, maintaining 99.95% uptime on AWS ECS.' },
        { role: 'ai', text: 'How did you approach database migrations and indexing with PostgreSQL?' },
        { role: 'candidate', text: 'We used Alembic for versioned schema migrations with zero-downtime deploy procedures and added targeted composite indices on merchant settlement tables.' }
      ],
      roadmapProfile: {
        name: 'Adaeze Okafor',
        headline: 'Lead Backend Engineer | Payments & Distributed Systems',
        location: 'Lagos, Nigeria (Remote)',
        phone: '+2348031234567',
        email: 'adaeze.okafor@example.com',
        links: {
          linkedin: 'https://linkedin.com/in/adaeze-okafor',
          github: 'https://github.com/adaeze-builds'
        },
        summary: 'Senior Backend Engineer with 5+ years experience architecting core payment APIs and distributed microservices with FastAPI, PostgreSQL, and AWS.',
        education: [
          {
            school: 'University of Lagos (UNILAG)',
            degree: 'B.Sc.',
            field: 'Computer Science',
            year: '2015 - 2019',
            details: 'First Class Honours'
          }
        ],
        roadmap: [
          {
            company: 'PaySprint Technologies (Series A)',
            role: 'Lead Payments Engineer',
            duration: '2021 - Present',
            scale: '2M req/day across 40 fintech merchants',
            highlights: [
              'Architected RESTful payments API in FastAPI and PostgreSQL with 99.95% uptime.',
              'Designed idempotent settlement ledger handling over $12M monthly transaction volume.'
            ]
          },
          {
            company: 'Logistix Express Lagos',
            role: 'Backend Developer',
            duration: '2019 - 2021',
            scale: '10,000 daily parcel dispatches',
            highlights: [
              'Built vehicle dispatch tracking service using Python, Redis, and WebSockets.'
            ]
          }
        ],
        skills: {
          languages: ['Python', 'SQL', 'Go', 'Bash'],
          frameworks: ['FastAPI', 'Django', 'Flask'],
          databases: ['PostgreSQL', 'Redis', 'MySQL'],
          cloud: ['AWS (ECS, RDS)', 'Docker', 'GitHub Actions'],
          tools: ['Alembic', 'Postman', 'Sentry']
        }
      },
      cv: [
        'Adaeze Okafor',
        'Backend Engineer, 5 years of experience',
        'Led the payments API at a Series A startup, built in Python (FastAPI) on PostgreSQL.',
        'Shipped a public REST API used by 40 merchants; handled 2M requests a day.',
        'Deployed services on AWS (ECS, RDS) with Docker.',
        'Earlier: backend developer at a Lagos logistics company.'
      ].join('\n')
    },
    {
      name: 'Tunde Bakare',
      phone: '+2348023456789',
      email: 'tunde.bakare@example.com',
      consent: true,
      rankingPercentile: 'Top 10%',
      cv: [
        'Tunde Bakare',
        'Software engineer, 4 years of experience building backend systems.',
        'Built internal tools and customer-facing services in Python and Django.',
        'Designed the data layer and wrote the ORM models for a lending product.',
        'Worked in a small founding team at an early-stage startup.',
        'Comfortable owning features from design to release.'
      ].join('\n')
    },
    {
      name: 'Chiamaka Eze',
      phone: '+2348098765432',
      email: 'chiamaka.eze@example.com',
      consent: false,
      rankingPercentile: 'Top 25%',
      cv: [
        'Chiamaka Eze',
        'Recent graduate, Computer Science.',
        'Backend internship (6 months) building small services in Go.',
        'Final-year project: a booking app with PostgreSQL.',
        'Open source contributor; strong interest in fintech.'
      ].join('\n')
    },
    {
      name: 'Ibrahim Sule',
      phone: '+2349091122334',
      email: 'ibrahim.sule@example.com',
      consent: true,
      rankingPercentile: 'Top 5%',
      cv: [
        'Ibrahim Sule',
        'Senior engineer with 7 years of experience in backend services.',
        'Core member of a Go team running high-traffic services in production.',
        'Owned the backend of a marketplace used by thousands of sellers.',
        'Runs infrastructure on Google Cloud (GKE, Cloud SQL).',
        'Mentors junior engineers.'
      ].join('\n')
    }
  ];

  return { JOB: JOB, CANDIDATES: CANDIDATES };
});
