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
