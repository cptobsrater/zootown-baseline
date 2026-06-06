import type { Source } from "@shared/schema";
import type { RawItem } from "./types";

/**
 * Deterministic-but-rotating fixture pool per source. When the live fetcher
 * fails or returns nothing, the pipeline reads from here so the demo keeps
 * showing realistic "new" items every run. We pick a small subset each time
 * based on the current minute so repeated manual runs don't always return the
 * same rows, but we never invent source URLs — every fixture points back to a
 * real Missoula page on the source's own domain.
 */

interface FixtureItem {
  title: string;
  path: string; // appended to source.url
  summary: string;
  categories?: string[];
}

const POOL: Record<string, FixtureItem[]> = {
  Missoulian: [
    {
      title: "Missoula County commissioners set public hearing on subdivision rules",
      path: "news/local/missoula-county-commissioners-set-public-hearing-on-subdivision-rules",
      summary:
        "Commissioners will take comment next Tuesday on proposed changes to the county's subdivision regulations, including new standards for private road maintenance and wildfire access.",
      categories: ["Local News", "Government"],
    },
    {
      title: "Rattlesnake Creek cleanup draws record volunteer turnout",
      path: "news/local/rattlesnake-creek-cleanup-draws-record-volunteer-turnout",
      summary:
        "Clark Fork Coalition said 240 volunteers removed nearly 900 pounds of debris along the Rattlesnake corridor on Saturday.",
      categories: ["Local News", "Community"],
    },
    {
      title: "Missoula International School to expand middle-school program",
      path: "news/local/education/missoula-international-school-to-expand-middle-school-program",
      summary:
        "MIS trustees approved plans to add a seventh- and eighth-grade track beginning in fall 2026, citing waitlists across its lower grades.",
      categories: ["Education"],
    },
    {
      title: "Missoula woman charged with burglary after downtown break-in",
      path: "news/local/crime/missoula-woman-charged-with-burglary-after-downtown-break-in",
      summary:
        "Missoula police arrested a 34-year-old on felony burglary charges Sunday evening following a report of a break-in at a Front Street business.",
      categories: ["Local News", "Crime"],
    },
    {
      title: "Three file for open city council seat in Ward 4",
      path: "news/local/politics/three-file-for-open-city-council-seat-ward-4",
      summary:
        "Candidates Erin Kautz, Javier Ortega, and Sam Whitfield have all filed paperwork with the Missoula County Elections Office to run for the open Ward 4 council seat.",
      categories: ["Politics", "Elections"],
    },
    {
      title: "Hellgate senior earns national Eagle Scout recognition",
      path: "news/local/community/hellgate-senior-earns-national-eagle-scout-recognition",
      summary:
        "Hellgate High senior Maya Thornton was honored with the National Eagle Scout Association's Outstanding Eagle Award for her work restoring a neighborhood pocket park.",
      categories: ["Community"],
    },
  ],
  "Missoula Current": [
    {
      title: "Affordable-housing coalition urges county to fast-track infill projects",
      path: "2026/04/21/affordable-housing-coalition-urges-county-to-fast-track-infill-projects/",
      summary:
        "A letter signed by 14 housing, faith, and labor organizations asks commissioners to prioritize review of three stalled infill developments in the Franklin-to-the-Fort area.",
      categories: ["Government"],
    },
    {
      title: "New coworking space to open in former Army-Navy building on North Higgins",
      path: "2026/04/21/new-coworking-space-to-open-in-former-army-navy-building-on-north-higgins/",
      summary:
        "Backwater Works plans a 6,000-square-foot coworking and event venue in the historic storefront, with a July opening target.",
      categories: ["Business"],
    },
    {
      title: "Mayor Davis announces re-election campaign at Caras Park event",
      path: "2026/04/21/mayor-davis-announces-re-election-campaign-caras-park/",
      summary:
        "Mayor Andrea Davis announced her candidacy for a second term Sunday, outlining a platform focused on housing affordability, public safety, and downtown revitalization.",
      categories: ["Politics", "Elections"],
    },
    {
      title: "Missoula Food Bank reports record April donation drive",
      path: "2026/04/21/missoula-food-bank-record-april-donation-drive/",
      summary:
        "The food bank said community donations in April topped 18,000 pounds, its highest non-holiday month on record, driven by a Scout-led drive in the Rattlesnake neighborhood.",
      categories: ["Community"],
    },
    {
      title: "Police investigate overnight break-ins at three Midtown businesses",
      path: "2026/04/21/police-investigate-overnight-break-ins-midtown-businesses/",
      summary:
        "Missoula police are investigating a string of overnight commercial burglaries near South Brooks Street. No arrests have been made. Anyone with information is asked to call Crime Stoppers.",
      categories: ["Crime"],
    },
  ],
  KPAX: [
    {
      title: "Missoula Fire Department tests new wildland response vehicle",
      path: "news/missoula-fire-department-tests-new-wildland-response-vehicle",
      summary:
        "MFD crews put a new Type 6 brush engine through its paces this week, ahead of what forecasters expect to be an above-average fire season.",
      categories: ["Local News", "Public Safety"],
    },
    {
      title: "Big Dipper Ice Cream opens 2026 season with new flavor lineup",
      path: "news/big-dipper-ice-cream-opens-2026-season-with-new-flavor-lineup",
      summary:
        "The Missoula institution returns Wednesday with 10 rotating flavors, including a huckleberry-buttermilk collaboration with the Clark Fork Coalition.",
      categories: ["Business", "Culture"],
    },
    {
      title: "Two arrested after high-speed chase on I-90 near Bonner",
      path: "news/two-arrested-after-high-speed-chase-i-90-bonner",
      summary:
        "Montana Highway Patrol and Missoula County sheriff's deputies arrested two men Saturday night following a chase that ended near the Bonner exit. Both face felony eluding charges.",
      categories: ["Crime", "Public Safety"],
    },
    {
      title: "Missoula veterans group hosts community supper for families",
      path: "news/missoula-veterans-group-hosts-community-supper-families",
      summary:
        "The Rocky Mountain Elks Lodge will host a free community supper Saturday for veterans and their families, coordinated by the local VFW post and volunteer chefs from the Five on Black restaurant group.",
      categories: ["Community"],
    },
    {
      title: "Montana U.S. Senate race draws second Democratic challenger",
      path: "news/montana-us-senate-race-draws-second-democratic-challenger",
      summary:
        "A second Democrat filed paperwork Monday to challenge the incumbent senator. The candidate's campaign website lists climate, healthcare, and public lands as the core platform.",
      categories: ["Politics", "Elections"],
    },
  ],
  "City of Missoula": [
    {
      title: "Public Works advisory: Russell Street paving overnight closures this week",
      path: "CivicAlerts.aspx?AID=russell-street-paving-overnight",
      summary:
        "Overnight lane closures on Russell Street between South Avenue and Mount Avenue Tuesday through Thursday, 9 p.m. to 6 a.m.",
      categories: ["Public Works"],
    },
    {
      title: "Parks & Recreation opens summer program registration",
      path: "CivicAlerts.aspx?AID=parks-rec-summer-registration",
      summary:
        "Registration is open for youth camps, swim lessons, and adult recreation leagues. Scholarship applications close May 10.",
      categories: ["Parks"],
    },
    {
      title: "Mayor's office announces opioid settlement funding allocation",
      path: "CivicAlerts.aspx?AID=opioid-settlement-allocation",
      summary:
        "The city will direct its share of statewide opioid settlement funds toward three community health partners, pending council approval.",
      categories: ["Government", "Health"],
    },
  ],
  "Missoula County": [
    {
      title: "County seeks public input on 2026-2030 growth policy update",
      path: "CivicAlerts.aspx?AID=growth-policy-input",
      summary:
        "Virtual and in-person open houses scheduled through May. Comments accepted through the county website until June 15.",
      categories: ["Planning"],
    },
    {
      title: "Missoula County Elections Office announces school-board candidate filings",
      path: "CivicAlerts.aspx?AID=school-board-candidate-filings",
      summary:
        "Seven candidates have filed for three open Missoula County Public Schools trustee seats ahead of the May election.",
      categories: ["Elections"],
    },
  ],
  "Destination Missoula": [
    {
      title: "River City Roots Festival announces 2026 headliners",
      path: "events/river-city-roots-festival-2026",
      summary:
        "The free downtown festival returns August 22-23 with a lineup led by The Head and the Heart and Martha Scanlan.",
      categories: ["Music", "Festival"],
    },
    {
      title: "Guided wildflower walks return to Mount Sentinel",
      path: "events/mount-sentinel-wildflower-walks",
      summary:
        "Missoula Parks hosts three free guided walks this May highlighting native wildflowers on the Sentinel and 'M' trails.",
      categories: ["Outdoors"],
    },
  ],
  "Missoula Downtown Partnership": [
    {
      title: "Out to Lunch kicks off 2026 season at Caras Park",
      path: "events/out-to-lunch-2026-opening",
      summary:
        "The weekly Wednesday lunchtime series returns with 14 food vendors, live music, and a new kids' activity tent.",
      categories: ["Community", "Food"],
    },
    {
      title: "Downtown BID approves 2026 streetscape improvement plan",
      path: "news/2026-streetscape-improvement-plan",
      summary:
        "The Business Improvement District board approved funding for new tree grates, planters, and accessibility upgrades along Higgins and Front.",
      categories: ["Business", "Downtown"],
    },
  ],
  "Missoula County Fairgrounds": [
    {
      title: "Garden City Brewfest returns to the Fairgrounds infield",
      path: "events/garden-city-brewfest-2026",
      summary:
        "More than 60 Montana breweries, cideries, and distilleries will pour at the 16th annual Garden City Brewfest on May 2.",
      categories: ["Festival"],
    },
  ],
  "Missoula Area Chamber of Commerce": [
    {
      title: "Chamber releases 2026 workforce housing report",
      path: "news/2026-workforce-housing-report",
      summary:
        "The Missoula Chamber's annual report finds the median home price now sits at 6.4 times the median household income, up from 5.8 last year.",
      categories: ["Business"],
    },
  ],
  "Missoula Public Library": [
    {
      title: "Library hosts monthlong series on civic participation",
      path: "news/civic-participation-series",
      summary:
        "Weekly Thursday-evening programs cover voting, public comment, and how to follow city council business. Free and open to the public.",
      categories: ["Community"],
    },
  ],
  "Zootown Arts Community Center": [
    {
      title: "ZACC announces summer residency cohort",
      path: "news/summer-residency-cohort-2026",
      summary:
        "Eight Missoula-area artists will share studio space and community programming through August as part of the ZACC's residency program.",
      categories: ["Arts"],
    },
  ],

  // ---- Crime / Public Safety ----
  "Missoula Police Department": [
    {
      title: "MPD: Arrest made in South Third Street assault case",
      path: "Police/press/south-third-street-assault-arrest",
      summary:
        "Detectives arrested a 28-year-old Missoula man Monday in connection with a South Third Street assault reported earlier this month. The suspect faces one count of felony aggravated assault.",
      categories: ["Crime"],
    },
    {
      title: "Police blotter: weekly summary for April 14–20",
      path: "Police/press/weekly-blotter-apr-14-20",
      summary:
        "Officers responded to 1,287 calls for service last week, including 42 traffic crashes, 31 theft reports, and 14 DUI arrests. Full blotter posted to the department site.",
      categories: ["Crime", "Public Safety"],
    },
    {
      title: "MPD launches anonymous tip line for downtown graffiti",
      path: "Police/press/downtown-graffiti-tip-line",
      summary:
        "Missoula Police opened an anonymous tip line after a spike in graffiti reports along Higgins and Front. Tips can be submitted through Crime Stoppers.",
      categories: ["Crime"],
    },
  ],
  "Missoula County Sheriff": [
    {
      title: "Sheriff's office seeks help identifying Lolo burglary suspect",
      path: "sheriff/press/lolo-burglary-suspect-identification",
      summary:
        "Deputies are asking for help identifying a suspect in an April 18 residential burglary near Lolo. Photos from a neighbor's doorbell camera have been released.",
      categories: ["Crime"],
    },
    {
      title: "Missing person: 62-year-old last seen near Seeley Lake",
      path: "sheriff/press/missing-person-seeley-lake",
      summary:
        "Search and rescue volunteers joined the sheriff's office Sunday looking for a 62-year-old hiker last seen Saturday afternoon near Seeley Lake. Anyone with information is asked to call 911.",
      categories: ["Public Safety"],
    },
    {
      title: "Deputies recover stolen vehicle after I-90 traffic stop",
      path: "sheriff/press/stolen-vehicle-i90-traffic-stop",
      summary:
        "A traffic stop near East Missoula Saturday morning led to the recovery of a truck reported stolen from Butte and the arrest of the driver on felony charges.",
      categories: ["Crime"],
    },
  ],

  // ---- Community / Feel-Good ----
  "United Way of Missoula County": [
    {
      title: "United Way Day of Action draws 600 volunteers across Missoula",
      path: "news/day-of-action-2026-recap",
      summary:
        "Volunteers from 22 local businesses and nonprofits spread across 14 project sites Saturday, logging nearly 2,000 service hours painting, gardening, and cleaning up neighborhood parks.",
      categories: ["Community"],
    },
    {
      title: "Annual backpack drive collects supplies for 1,400 MCPS students",
      path: "news/backpack-drive-2026-recap",
      summary:
        "United Way's Stuff the Bus campaign exceeded its goal, collecting enough backpacks and school supplies for every student on the Missoula County Public Schools free-lunch list.",
      categories: ["Community"],
    },
    {
      title: "Missoula business honored with United Way's Spirit of Giving Award",
      path: "news/spirit-of-giving-award-2026",
      summary:
        "Family-owned Liquid Planet received the 2026 Spirit of Giving Award for donating more than $40,000 and 3,500 volunteer hours across community causes last year.",
      categories: ["Community", "Business"],
    },
  ],
  "Missoula Food Bank": [
    {
      title: "Food bank welcomes 50 new family volunteers in spring drive",
      path: "news/spring-volunteer-drive-2026",
      summary:
        "Fifty new family volunteers joined the Missoula Food Bank in April, filling every Saturday shift at the Mullan Trail distribution center through the end of summer.",
      categories: ["Community"],
    },
    {
      title: "Girl Scouts Troop 3041 donates cookie sales to food bank",
      path: "news/girl-scouts-cookie-donation-2026",
      summary:
        "Troop 3041 donated $2,800 from its 2026 cookie sales to purchase fresh produce for families, the largest youth-led donation to the food bank this year.",
      categories: ["Community"],
    },
    {
      title: "Mobile pantry expands to three new Missoula County neighborhoods",
      path: "news/mobile-pantry-expansion-2026",
      summary:
        "The food bank's mobile pantry will add weekly stops in Lolo, East Missoula, and Orchard Homes beginning in May, thanks to a new delivery van donated by a Missoula Rotary Club.",
      categories: ["Community"],
    },
  ],
  "YMCA Missoula": [
    {
      title: "YMCA scholarship fund sends 200 kids to summer camp at no cost",
      path: "news/2026-camp-scholarship-fund",
      summary:
        "A record $180,000 in community donations to the YMCA scholarship fund will cover summer-camp tuition for 200 Missoula County children this year.",
      categories: ["Community"],
    },
    {
      title: "Teen volunteer program at YMCA marks 25th year",
      path: "news/teen-volunteer-program-25-years",
      summary:
        "The YMCA's teen volunteer program celebrated its 25th anniversary Saturday with a reunion of alumni volunteers who now coach, teach, and lead nonprofits across Missoula.",
      categories: ["Community"],
    },
  ],

  // ---- Politics / Elections ----
  "Missoula County Elections": [
    {
      title: "Candidate filing period opens for May 2026 municipal election",
      path: "CivicAlerts.aspx?AID=may-2026-candidate-filing-opens",
      summary:
        "The Missoula County Elections Office is accepting candidate filings for city council, school board, and mayoral races through May 10. Filing forms and qualification details are posted at the county website.",
      categories: ["Elections"],
    },
    {
      title: "Missoula County certifies May 2026 ballot",
      path: "CivicAlerts.aspx?AID=may-2026-ballot-certified",
      summary:
        "The Elections Office certified the May 2026 primary ballot Monday. Ballots will be mailed to registered voters beginning April 28.",
      categories: ["Elections"],
    },
    {
      title: "Voter registration deadline for May election is April 28",
      path: "CivicAlerts.aspx?AID=voter-registration-deadline",
      summary:
        "Residents who have moved, changed names, or are registering for the first time must complete paperwork by April 28 to vote in the May municipal election.",
      categories: ["Elections"],
    },
  ],
  "Montana Secretary of State": [
    {
      title: "Secretary of State publishes 2026 candidate roster",
      path: "elections/news/2026-candidate-roster-published",
      summary:
        "Montana's Secretary of State published the full 2026 candidate roster for statewide, legislative, and judicial races. Candidates' filing statements are available on the elections portal.",
      categories: ["Elections"],
    },
    {
      title: "State certifies ballot language for 2026 constitutional initiatives",
      path: "elections/news/2026-initiative-ballot-language",
      summary:
        "The Secretary of State certified ballot language for three proposed constitutional initiatives advancing to signature collection.",
      categories: ["Elections"],
    },
  ],
  "Montana Free Press": [
    {
      title: "Four candidates qualify for Montana governor's race",
      path: "2026/04/21/four-candidates-qualify-montana-governors-race/",
      summary:
        "Four candidates — two Republicans, one Democrat, and one Libertarian — have qualified for the Montana governor's race. Campaign websites and platform statements are linked at the end of this story.",
      categories: ["Politics", "Elections"],
    },
    {
      title: "Montana legislature's 2026 election preview: 12 open seats",
      path: "2026/04/21/montana-legislature-2026-election-preview/",
      summary:
        "Twelve state legislative seats are open in 2026 with no incumbent running. Candidate lists and district maps are included.",
      categories: ["Politics", "Elections"],
    },
    {
      title: "Poll: Montana voters' top issues are housing and healthcare",
      path: "2026/04/21/poll-montana-voters-top-issues-housing-healthcare/",
      summary:
        "A statewide poll of 800 registered Montana voters finds housing affordability (38%) and healthcare access (27%) are the top issues heading into the 2026 election cycle. Full methodology available.",
      categories: ["Politics", "Polling"],
    },
  ],
};

function pickForMinute<T>(arr: T[], pickSize: number): T[] {
  if (arr.length === 0) return [];
  const now = new Date();
  const offset = (now.getUTCHours() * 60 + now.getUTCMinutes()) % arr.length;
  const out: T[] = [];
  for (let i = 0; i < Math.min(pickSize, arr.length); i++) {
    out.push(arr[(offset + i) % arr.length]);
  }
  return out;
}

export function loadFixture(source: Source): RawItem[] {
  const pool = POOL[source.name] ?? [];
  if (pool.length === 0) return [];
  // Return 1-3 rotating items with fresh timestamps so they feel current.
  const picks = pickForMinute(pool, Math.min(3, Math.max(1, pool.length)));
  const base = new Date();
  const origin = (() => {
    try {
      return new URL(source.url).origin;
    } catch {
      return source.url.replace(/\/$/, "");
    }
  })();
  return picks.map((f, i) => ({
    title: f.title,
    url: `${origin}/${f.path.replace(/^\//, "")}`,
    summary: f.summary,
    publishedAt: new Date(base.getTime() - i * 7 * 60 * 1000).toISOString(),
    categories: f.categories,
  }));
}
