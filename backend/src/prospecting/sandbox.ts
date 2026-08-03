import type {
  ContactDataProvider,
  ProspectMatch,
  ProspectQuery,
  ProspectSearchResult,
  RevealedContact,
} from './ports.js';

/**
 * The sandbox provider: a licensed vendor's shape, with invented people.
 *
 * It exists so the whole feature — search, credit-charged reveal, dedupe,
 * suppression, import to a lead — can be built, demonstrated and tested before
 * a data contract is signed, exactly as the estimator's fixture connectors do.
 *
 * The cast is deliberately the one a restoration company actually sells to:
 * property managers, adjusters, general contractors and facilities directors.
 * Some of them have no phone on file and some have no email, because a search
 * that always returns a full record teaches the UI nothing about the case
 * where a customer would be paying for half a contact.
 *
 * Every name, address and number below is invented. None of it is real
 * personal data, and it must never be presented to a customer as though it
 * were — the `sandbox` flag is what the UI reads to say so.
 */

interface SeedPerson extends ProspectMatch {
  email: string | null;
  phone: string | null;
  mobile: string | null;
  industry: string;
}

const PEOPLE: SeedPerson[] = [
  {
    providerPersonId: 'sbx-1',
    fullName: 'Marcia Delgado',
    title: 'Regional Property Manager',
    companyName: 'Vantage Residential',
    companyDomain: 'vantageresidential.example',
    location: 'Austin, TX',
    linkedinUrl: null,
    confidence: 0.94,
    hasEmail: true,
    hasPhone: true,
    email: 'm.delgado@vantageresidential.example',
    phone: '(512) 555-0110',
    mobile: '(512) 555-0111',
    industry: 'property management',
  },
  {
    providerPersonId: 'sbx-2',
    fullName: 'Ray Calloway',
    title: 'Senior Field Adjuster',
    companyName: 'Alliance Mutual',
    companyDomain: 'alliancemutual.example',
    location: 'Austin, TX',
    linkedinUrl: null,
    confidence: 0.88,
    hasEmail: true,
    hasPhone: false,
    email: 'r.calloway@alliancemutual.example',
    phone: null,
    mobile: null,
    industry: 'insurance',
  },
  {
    providerPersonId: 'sbx-3',
    fullName: 'Tomas Bergeron',
    title: 'Facilities Director',
    companyName: 'Northgate Medical Group',
    companyDomain: 'northgatemed.example',
    location: 'Round Rock, TX',
    linkedinUrl: null,
    confidence: 0.91,
    hasEmail: true,
    hasPhone: true,
    email: 't.bergeron@northgatemed.example',
    phone: '(512) 555-0148',
    mobile: null,
    industry: 'healthcare',
  },
  {
    providerPersonId: 'sbx-4',
    fullName: 'Priscilla Nunes',
    title: 'Owner',
    companyName: 'Nunes General Contracting',
    companyDomain: 'nunesgc.example',
    location: 'Austin, TX',
    linkedinUrl: null,
    confidence: 0.79,
    hasEmail: false,
    hasPhone: true,
    email: null,
    phone: '(512) 555-0173',
    mobile: '(512) 555-0174',
    industry: 'construction',
  },
  {
    providerPersonId: 'sbx-5',
    fullName: 'Devon Ashby',
    title: 'Director of Operations',
    companyName: 'Camden Court HOA',
    companyDomain: 'camdencourt.example',
    location: 'Austin, TX',
    linkedinUrl: null,
    confidence: 0.86,
    hasEmail: true,
    hasPhone: true,
    email: 'd.ashby@camdencourt.example',
    phone: '(512) 555-0139',
    mobile: null,
    industry: 'property management',
  },
  {
    providerPersonId: 'sbx-6',
    fullName: 'Karen Whitfield',
    title: 'Claims Team Lead',
    companyName: 'Lone Star Casualty',
    companyDomain: 'lonestarcasualty.example',
    location: 'San Antonio, TX',
    linkedinUrl: null,
    confidence: 0.83,
    hasEmail: true,
    hasPhone: true,
    email: 'k.whitfield@lonestarcasualty.example',
    phone: '(210) 555-0192',
    mobile: '(210) 555-0193',
    industry: 'insurance',
  },
  {
    providerPersonId: 'sbx-7',
    fullName: 'Andre Sokolov',
    title: 'Portfolio Manager',
    companyName: 'Hillcrest Commercial Realty',
    companyDomain: 'hillcrestcre.example',
    location: 'Austin, TX',
    linkedinUrl: null,
    confidence: 0.72,
    hasEmail: false,
    hasPhone: false,
    email: null,
    phone: null,
    mobile: null,
    industry: 'real estate',
  },
  {
    providerPersonId: 'sbx-8',
    fullName: 'Lena Ortiz-Park',
    title: 'Facilities Manager',
    companyName: 'Brightway Dental Partners',
    companyDomain: 'brightwaydental.example',
    location: 'Austin, TX',
    linkedinUrl: null,
    confidence: 0.9,
    hasEmail: true,
    hasPhone: true,
    email: 'l.ortizpark@brightwaydental.example',
    phone: '(512) 555-0166',
    mobile: null,
    industry: 'healthcare',
  },
  {
    providerPersonId: 'sbx-9',
    fullName: 'Grant Feasley',
    title: 'VP Construction',
    companyName: 'Sundial Property Group',
    companyDomain: 'sundialpg.example',
    location: 'Dallas, TX',
    linkedinUrl: null,
    confidence: 0.81,
    hasEmail: true,
    hasPhone: false,
    email: 'g.feasley@sundialpg.example',
    phone: null,
    mobile: null,
    industry: 'property management',
  },
  {
    providerPersonId: 'sbx-10',
    fullName: 'Nadia Brennan',
    title: 'Independent Adjuster',
    companyName: 'Brennan Claims Services',
    companyDomain: 'brennanclaims.example',
    location: 'Round Rock, TX',
    linkedinUrl: null,
    confidence: 0.77,
    hasEmail: true,
    hasPhone: true,
    email: 'nadia@brennanclaims.example',
    phone: '(512) 555-0155',
    mobile: '(512) 555-0156',
    industry: 'insurance',
  },
];

function matches(person: SeedPerson, query: ProspectQuery): boolean {
  const hay = [person.fullName, person.title, person.companyName, person.industry]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (query.q && !hay.includes(query.q.trim().toLowerCase())) return false;

  if (query.location) {
    const want = query.location.trim().toLowerCase();
    if (!(person.location ?? '').toLowerCase().includes(want)) return false;
  }

  if (query.companyDomain) {
    const want = query.companyDomain.trim().toLowerCase();
    if ((person.companyDomain ?? '').toLowerCase() !== want) return false;
  }

  if (query.industry) {
    const want = query.industry.trim().toLowerCase();
    if (!person.industry.includes(want)) return false;
  }

  if (query.titles?.length) {
    const title = (person.title ?? '').toLowerCase();
    if (!query.titles.some((t) => title.includes(t.trim().toLowerCase()))) return false;
  }

  return true;
}

/** Strips the paid columns — a search must never leak what a reveal sells. */
function toMatch(person: SeedPerson): ProspectMatch {
  return {
    providerPersonId: person.providerPersonId,
    fullName: person.fullName,
    title: person.title,
    companyName: person.companyName,
    companyDomain: person.companyDomain,
    location: person.location,
    linkedinUrl: person.linkedinUrl,
    confidence: person.confidence,
    hasEmail: person.hasEmail,
    hasPhone: person.hasPhone,
  };
}

export class SandboxContactProvider implements ContactDataProvider {
  readonly name = 'Sandbox';
  readonly sandbox = true;

  async verify(): Promise<void> {
    // Nothing to authenticate against.
  }

  async search(query: ProspectQuery): Promise<ProspectSearchResult> {
    const hits = PEOPLE.filter((p) => matches(p, query));
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    return { matches: hits.slice(0, limit).map(toMatch), total: hits.length };
  }

  async getPerson(providerPersonId: string): Promise<ProspectMatch | null> {
    const person = PEOPLE.find((p) => p.providerPersonId === providerPersonId);
    return person ? toMatch(person) : null;
  }

  async reveal(providerPersonId: string): Promise<RevealedContact | null> {
    const person = PEOPLE.find((p) => p.providerPersonId === providerPersonId);
    if (!person) return null;
    // A vendor that holds nothing returns nothing, and the caller must not
    // charge for it. Sokolov exists to exercise exactly that path.
    if (!person.email && !person.phone && !person.mobile) return null;
    return {
      providerPersonId: person.providerPersonId,
      email: person.email,
      phone: person.phone,
      mobile: person.mobile,
      confidence: person.confidence,
      // No vendor invoice behind synthetic data.
      costNanos: 0,
    };
  }
}
