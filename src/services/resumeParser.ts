import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ParsedResume {
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  role: string | null;
  specialties: string[];
  skills: string[];
  certifications: string[];
  licenses: string[];
  education: Array<{ degree: string; institution: string; year: string | null }>;
  work_history: Array<{
    title: string;
    employer: string;
    start_date: string | null;
    end_date: string | null;
    description: string | null;
  }>;
  years_experience: number | null;
  summary: string | null;
}

const PARSE_PROMPT = `You are a resume parser for a healthcare staffing agency. Extract ALL of the following from the resume content provided and return ONLY valid JSON with no markdown code blocks, no explanation, just raw JSON.

Return exactly this structure:
{
  "name": "full name or null",
  "email": "email address or null",
  "phone": "phone number or null",
  "address": "full address or null",
  "role": "primary nursing/healthcare role such as RN, LPN, LVN, CNA, RT, NP, PA, or null",
  "specialties": ["list of medical specialties like ICU, ER, Med-Surg, etc."],
  "skills": ["list of clinical skills"],
  "certifications": ["BLS", "ACLS", "PALS", etc.],
  "licenses": ["State RN License #12345", etc.],
  "education": [{"degree": "BSN", "institution": "University Name", "year": "2018"}],
  "work_history": [{"title": "Staff RN", "employer": "Hospital Name", "start_date": "2020-01", "end_date": "2023-06", "description": "Brief role description"}],
  "years_experience": 5,
  "summary": "brief professional summary"
}

If any field cannot be determined, use null for scalars or [] for arrays. Do not fabricate information.`;

export async function parseResume(fileBuffer: Buffer, mimeType: string): Promise<ParsedResume> {
  let responseText: string;

  try {
    if (mimeType === 'application/pdf') {
      // Use Claude's document vision for PDFs
      const base64Data = fileBuffer.toString('base64');
      const response = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: base64Data,
                },
              } as any,
              {
                type: 'text',
                text: PARSE_PROMPT,
              },
            ],
          },
        ],
      });
      responseText = (response.content[0] as any).text;
    } else {
      // For DOCX, text files, or unknown types — try to extract as UTF-8 text
      const textContent = fileBuffer.toString('utf-8');
      const response = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${PARSE_PROMPT}\n\nResume content:\n${textContent}`,
          },
        ],
      });
      responseText = (response.content[0] as any).text;
    }

    // Strip markdown code blocks if Claude wrapped the JSON
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned) as ParsedResume;

    // Ensure arrays are arrays
    const safe = (val: any) => (Array.isArray(val) ? val : []);
    return {
      name: parsed.name || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      address: parsed.address || null,
      role: parsed.role || null,
      specialties: safe(parsed.specialties),
      skills: safe(parsed.skills),
      certifications: safe(parsed.certifications),
      licenses: safe(parsed.licenses),
      education: safe(parsed.education),
      work_history: safe(parsed.work_history),
      years_experience: parsed.years_experience || null,
      summary: parsed.summary || null,
    };
  } catch (err) {
    console.error('Resume parsing error:', err);
    // Return empty structure on failure
    return {
      name: null, email: null, phone: null, address: null, role: null,
      specialties: [], skills: [], certifications: [], licenses: [],
      education: [], work_history: [], years_experience: null, summary: null,
    };
  }
}
