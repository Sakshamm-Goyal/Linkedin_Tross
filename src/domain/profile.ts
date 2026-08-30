export interface DateParts {
  year: number | null;
  month: number | null;
}

export interface DateRange {
  start: DateParts | null;
  end: DateParts | null;
  current: boolean;
}

export interface Experience {
  title: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
  employment_type: string | null;
  date_range: DateRange | null;
}

export interface Education {
  school: string | null;
  degree: string | null;
  field_of_study: string | null;
  description: string | null;
  date_range: DateRange | null;
}

export interface Certification {
  name: string | null;
  authority: string | null;
  license_number: string | null;
  url: string | null;
  date_range: DateRange | null;
}

export interface Language {
  name: string;
  proficiency: string | null;
}

export interface LinkedInProfile {
  profile_url: string;
  public_identifier: string;
  linkedin_id: string | null;
  name: {
    first: string | null;
    last: string | null;
    full: string | null;
  };
  headline: string | null;
  location: string | null;
  about: string | null;
  profile_images: {
    avatar_url: string | null;
    background_url: string | null;
  };
  experience: Experience[];
  education: Education[];
  skills: string[];
  certifications: Certification[];
  languages: Language[];
}

export interface ExtractionMeta {
  fetched_at: string;
  cached: boolean;
  completeness: "complete" | "partial";
  unavailable_sections: string[];
  parser_version: string;
  warnings: string[];
}

export interface ExtractionResult {
  status: "success";
  data: LinkedInProfile;
  meta: ExtractionMeta;
}
