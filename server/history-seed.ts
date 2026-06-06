import type { InsertHistoryStory } from "@shared/schema";

export type HistoryStoryInput = Omit<InsertHistoryStory, "publishedAt" | "lastBumpedAt">;

export const HISTORY_SEED: HistoryStoryInput[] = [
  {
    headline: "Before Missoula: The Hellgate Trading Post and the Birth of a River Town (1860)",
    summary: `## The Salish Crossing

Long before the first American settlers drove their wagon wheels into the valley, the Salish people knew this place by a name that meant something like "near the cold, chilling waters." Missoula sits at the confluence of the Bitterroot, Blackfoot, and Clark Fork rivers — a crossroads of water, mountain pass, and bison trail that made it one of the most naturally trafficked corridors in the Northern Rockies.

The name "Missoula" itself is an anglicized rendering of the Salish word *nmesuletkw*, which translates roughly as "the place of the cold, chilling waters" or, in some interpretations, "by the chilling waters." The phonetic drift that produced "Missoula" happened gradually as French-Canadian trappers and American surveyors tried to write down what Salish speakers said. The valley had been a meeting point for multiple Indigenous nations — the Salish, Pend d'Oreilles, and seasonal visitors from the Nez Perce and Blackfeet — long before the word "Montana" existed.

## Hell Gate Canyon and the Fear It Inspired

The canyon east of town, where the Clark Fork knifes through steep limestone walls, was called *Im-i-sul-etku* by the Salish — "the place of fear" or "ambush place." French-Canadian trappers, who had their own reasons to fear an ambush, translated it as *Porte de l'Enfer*: Gate of Hell. American maps softened it to Hellgate. The canyon's tight walls and sudden bends made it ideal for raids; Blackfeet war parties had long used it to strike Salish hunting camps moving toward the plains. By the time American settlement arrived in earnest, the canyon had absorbed decades of violent history.

## Christopher Higgins, Francis Worden, and the First Store

In 1860, a pair of entrepreneurs named Frank Worden and Christopher Higgins recognized what the Salish had always known: this was a place where trails converged. They built a small trading post and sawmill near the mouth of Hellgate Canyon, roughly four miles east of the modern city center. The enterprise was called the Worden & Higgins store, and it stocked flour, whiskey, dry goods, and the kind of hardware that miners — then flooding into the Bitterroot Valley following Civil War–era gold rushes — desperately needed.

The location was commercially shrewd. The post sat astride a segment of what would later be recognized as the Mullan Road, a military wagon route connecting Fort Benton on the Missouri River to Fort Walla Walla on the Columbia. Trade flowed east and west along the Clark Fork corridor, and Worden & Higgins sat at the pinch point.

## Moving to the Flats

By 1865, it was clear that the real opportunity lay not at the canyon mouth but on the open floodplain to the west — what residents now call the Rattlesnake, downtown, and the University District. Worden and Higgins relocated their operation and began platting town lots on a street grid that still defines Missoula's core. The original 1860 site quietly faded; the new town on the flats did not.

When the Northern Pacific Railroad arrived in 1883, Missoula ceased to be a trading post and became a regional center. The railroad brought ice, newspapers, manufactured goods, and enough people to fill the streets that Higgins and Worden had drawn on paper two decades before. The cold, chilling waters had found their city.`,
    sourceUrl: "https://en.wikipedia.org/wiki/Missoula,_Montana",
  },
  {
    headline: "The University of Montana's Unlikely Founding: How Missoula Beat Bozeman (1893)",
    summary: `## A State, a Legislature, and Four Competing Cities

When Montana achieved statehood in 1889, one of the legislature's first political battles was not about mining law or railroad rates but about which city would get what. The new state needed institutions: a capital (Helena won), an agricultural college (Bozeman), a school of mines (Butte), and a state university. Four cities — Missoula, Helena, Bozeman, and Great Falls — each lobbied for the university with the particular intensity that comes from knowing a university means jobs, real estate values, and a permanent claim on the future.

## The 1893 Vote

The Montana legislature awarded the university to Missoula in February 1893. The margin was not overwhelming, and the decision was colored by the usual legislative horse-trading: Missoula got the university; Bozeman had already secured the agricultural college; Butte got its school of mines; Dillon got a normal school. Each city got something. Missoula's boosters had spent years arguing that their city's position at a mountain gateway, its access to the Clark Fork watershed, and its growing rail connections made it the right site for a school of arts and sciences.

## A Hilltop and Forty Acres

The site chosen was a benchland south of downtown, at the base of Mount Sentinel, overlooking the valley. The university opened in the fall of 1895 with fifty students and four faculty members. The first building — University Hall, still standing — was a red brick structure that cost $49,931 to construct. President Oscar Craig, the university's founding leader, set a tone that emphasized teaching across the liberal arts, a commitment that distinguished the Missoula campus from the more vocational focus of the Bozeman school.

## The Oval and What It Meant

The University's signature landscape feature — the Oval, a long elliptical lawn bordered by elms, connecting the original buildings — was conceived early and realized slowly. It became the physical expression of a certain kind of educational ambition: unhurried, classical, set apart from the commercial city below. The Oval remains one of Montana's most recognizable civic spaces.

Within two decades, the University of Montana had a law school (1911), a forestry program (one of the nation's earliest), and a journalism school (1914) that would eventually earn a national reputation. The 1893 legislative vote that might have looked like provincial horse-trading produced something lasting: a research university in a mountain valley that has shaped Montana's intellectual and cultural life for more than 130 years.`,
    sourceUrl: "https://en.wikipedia.org/wiki/University_of_Montana",
  },
  {
    headline: "The Big Burn of 1910: How the Worst Wildfire in American History Shaped Missoula",
    summary: `## Three Million Acres in Two Days

On the evening of August 20, 1910, hurricane-force winds swept across the northern Rockies and merged dozens of separate forest fires into a single catastrophe. In roughly 48 hours, the conflagration consumed approximately three million acres across Idaho, Montana, and Washington — an area larger than the state of Connecticut. At least 85 people died, most of them U.S. Forest Service firefighters. The event, which survivors and historians came to call the Big Blowup or the Big Burn, remains the largest wildfire in recorded American history.

## Missoula at the Center

Missoula was not burned — the city sat far enough west of the main fire front — but it was inextricably bound up in the disaster. The U.S. Forest Service's Region 1 headquarters, established in Missoula just three years earlier in 1907, was the administrative hub coordinating thousands of firefighters across the burning landscape. Gifford Pinchot had founded the Forest Service in 1905; the 1910 season was the new agency's first genuine test, and it was a catastrophic one.

Regional Forester William Greeley directed response efforts from Missoula even as telegraph lines burned and communication failed across the front. Trains running out of Missoula carried injured firefighters to improvised hospitals. The city's residents could see orange light on the eastern horizon for days; ash fell on Higgins Avenue.

## The Doctrine of Total Fire Suppression

The political and philosophical aftermath of 1910 shaped American land management for the next seven decades. Humiliated by the fire's devastation, Forest Service leadership in the years following 1910 committed the agency to a policy of aggressive suppression: every fire would be fought, every blaze extinguished by ten o'clock the morning after it was discovered. The "10 a.m. policy" became official doctrine.

From Missoula, that doctrine was administered, refined, and — in the late twentieth century — ultimately questioned. Ecologists and fire historians looking back at 1910 would argue that the no-fire policy, though well-intentioned, set up western forests for even larger catastrophes by allowing fuel loads to accumulate across landscapes that had evolved to burn regularly. The fires that have swept across the West in recent decades are in part the inheritance of choices made in the smoke-filled summer of 1910.

## A Legacy in Smoke

The Big Burn's most tangible legacy in Missoula is the smokejumper program — established here in 1939 — and the broader culture of wildfire research and management that has grown up around the university and the Forest Service campus. Every summer, when smoke hazes the valley and the Clark Fork runs low, the valley is living inside a story that started in August of 1910.`,
    sourceUrl: "https://en.wikipedia.org/wiki/Big_Burn_(1910)",
  },
  {
    headline: "Lewis and Clark Come Through: The Lolo Trail and a Valley's First Recorded Visit (1805–1806)",
    summary: `## A Corps Exhausted and Hungry

On September 9, 1805, the Corps of Discovery descended from the Bitterroot Valley into the broad confluence where the Bitterroot River meets the Clark Fork. They were in poor shape. The crossing of the Bitterroot Mountains via the Lolo Trail had been one of the hardest stretches of the entire expedition — steep, snowbound ridges with almost no game, horses slipping on ice, men reduced to eating candles and boiled bear oil to survive. When the Corps emerged into the valley, they were among the first Euro-Americans to set eyes on the landscape that would become Missoula.

## The Lolo Trail

The route they followed — what Corps members called "Lolo's Creek" and the Nez Perce called *Nee-Me-Poo* (the people's trail) — had been used for centuries as a corridor between the high plains east of the Rockies and the salmon-rich rivers of the Columbia basin. The Nez Perce guided the Corps across this trail in both directions: westward in 1805 and eastward again in June 1806, when the expedition retraced its steps over the mountains. The Nez Perce's intimate knowledge of the trail's water sources, camp spots, and landmarks was the difference between survival and starvation for a group of men who had exhausted nearly everything they'd brought from St. Louis.

## Travelers' Rest and the Return

The Corps camped at a site near present-day Lolo, just south of Missoula, which they called Travelers' Rest — a place where multiple trails intersected and where the valley's grasslands offered their horses a chance to graze and recover. They camped there on both legs of the journey. Archaeologists in the early 2000s confirmed the site's location using soil analysis that identified mercury — present in the medicinal preparations Lewis used — at a campsite matching journal descriptions. Travelers' Rest is now a Montana state park.

## What the Journals Recorded

Meriwether Lewis's journals from this stretch of the journey are careful and observational. He noted the Clark Fork's clarity, the abundance of game sign in the valley, the beaver dams on tributary streams, and the quality of the grassy bottomland. He did not linger — the Corps's mission was to keep moving — but his entries captured a valley in its pre-settlement condition: densely forested on the hillsides, open and grassy on the flats, full of elk and deer, and criss-crossed by Indigenous trails that had served generations of travelers before the American nation knew this land existed.`,
    sourceUrl: "https://en.wikipedia.org/wiki/Lewis_and_Clark_Expedition",
  },
  {
    headline: "Mike Mansfield: The Bartender from Missoula Who Became the Longest-Serving Senate Leader in American History",
    summary: `## An Improbable Start

Michael Joseph Mansfield was born in New York City in 1903 and orphaned young, raised by relatives in Great Falls, Montana, after his mother died when he was three. He ran away from home at fourteen to join the Navy during World War I, enlisting by lying about his age. He went on to serve in the Army and the Marines before returning to Montana. By his mid-twenties, he was working as a copper miner in Butte and then as a bartender and miner in the broader Anaconda copper-mining world.

None of this suggested a future senator. What changed Mansfield's trajectory was education and a woman: Maureen Hayes, a school principal in Great Falls who was seven years his senior. She encouraged him to complete his high school equivalency, then to attend Montana State University in Missoula (today the University of Montana). He earned a bachelor's and then a master's degree in history and political science. The university hired him as a professor, a post he would hold until he went to Washington.

## From Missoula to the Senate

Mansfield was elected to the U.S. House of Representatives in 1942 from Montana's western district. He served six terms in the House, establishing a reputation for careful, independent foreign-policy thinking — he was one of the first members of Congress to raise serious questions about American involvement in Indochina. In 1952, he won a Senate seat, defeating an incumbent Republican.

In 1961, Lyndon Johnson vacated the Senate Majority Leader position to become Vice President. The Democratic caucus elected Mansfield to replace him. Mansfield served as Senate Majority Leader from 1961 to 1977 — sixteen consecutive years, a record that stands to this day and is unlikely to be broken.

## A Different Kind of Leadership

Mansfield's style was the inverse of his predecessor's. Where Johnson was famous for the physical and psychological arm-twisting he called "The Treatment," Mansfield was quiet, spare, and genuinely collegial. He believed senators had to be allowed to vote their conscience. He shepherded the Civil Rights Act of 1964 through the Senate, managed the procedural complexities of the Great Society legislation, and — crucially — broke with President Johnson over Vietnam. His open opposition to the war from his position as Majority Leader gave critical political cover to senators who shared his doubts but feared the electoral consequences.

## Ambassador, Professor, Missoula's Own

After retiring from the Senate in 1977, President Carter appointed Mansfield as U.S. Ambassador to Japan — a post he held for twelve years, spanning both Democratic and Republican administrations, a testament to the bipartisan respect he commanded. He died in Washington in 2001 at age ninety-eight. His ashes were interred in Arlington National Cemetery. The University of Montana's school of public affairs bears his name.`,
    sourceUrl: "https://en.wikipedia.org/wiki/Mike_Mansfield",
  },
  {
    headline: "Smokejumpers: How Missoula Became the Birthplace of Aerial Wildland Firefighting (1939)",
    summary: `## An Idea That Seemed Insane

By the late 1930s, the U.S. Forest Service's logistical problem with wildland fire was obvious to anyone who thought about it: most of the fires that grew into disasters started small — a lightning strike in a remote drainage, a campfire left burning — and remained controllable for hours or days before weather and terrain conspired to blow them up. The challenge was getting trained firefighters to those small fires before they grew. Horses were slow. Roads didn't exist. Trails took days.

The idea of parachuting firefighters directly into wilderness had circulated in the Forest Service since at least the early 1930s. It was treated, for a while, as a fantasy. Parachuting was new, dangerous, and associated with military daring rather than firefighting practicality. The Forest Service's Aerial Fire Control project began testing the concept in 1939, and they chose a site for the experiment that made sense given the agency's existing infrastructure: Missoula, home of the Region 1 headquarters.

## The First Jumps

The first experimental smokejumper jumps took place at the Nine Mile Remount Depot west of Missoula in July 1940, using surplus military parachutes. The early jumps were terrifying by modern standards — no reserve chute, tree landings navigated without the sophisticated gear that followed, equipment lowered on separate lines. Two jumpers were injured in those early tests.

Despite the rough start, the concept proved itself operationally during the 1940 fire season. Small fires in remote terrain were contained before they escaped. The time-to-fire calculation — the critical measure of how quickly a crew could reach a blaze from ignition — dropped dramatically.

## Missoula's Smokejumper Center

The North Cascades Smokejumper Base was established near the Missoula airport (now Missoula Montana Airport) in 1954 and became the primary training and operations center for smokejumpers in the northern Rockies. Today, the base — the oldest and largest smokejumper base in the country — still operates, training new jumpers and maintaining the skills of a profession that has changed less than most in the intervening decades.

The Missoula Smokejumper base offers public tours during fire season. Visitors can see the loft where chutes are packed and repacked, the obstacle courses where jumpers train, and the aircraft that carry crews over burning ridgelines. It remains one of the most distinctive and legitimate pieces of Missoula history — a place where a genuinely novel idea was tested, refined, and made real.`,
    sourceUrl: "https://en.wikipedia.org/wiki/Smokejumper",
  },
  {
    headline: "Norman Maclean and A River Runs Through It: How a Missoula Boyhood Became American Literature",
    summary: `## A Preacher's Sons and a Rocky Mountain River

Norman Maclean was born in Clarinda, Iowa, in 1902, but he grew up in Missoula, where his father — a Presbyterian minister named John Norman Maclean — had taken a pulpit. The family lived near the Clark Fork and the Blackfoot rivers, and the sons, Norman and Paul, grew up fishing. Not just fishing as a recreational activity, but fishing as a discipline, a spiritual practice, and — for the father at least — a form of scripture. John Norman Maclean taught his sons fly fishing with the same rigor he brought to his theology. Every cast had to be right.

Norman left Missoula for the University of Chicago, where he spent most of his academic career as an English professor. He didn't begin writing seriously about his Montana boyhood until he was in his seventies, after his wife died. What emerged was a novella — barely 100 pages — called *A River Runs Through It*.

## The Novella and Its Reception

*A River Runs Through It* was published in 1976 by the University of Chicago Press as part of a collection. Maclean was seventy-four years old. It sold modestly at first, then found its audience — particularly in the West and among readers drawn to its precision and grief. The novella is, on its surface, about fly fishing on the Blackfoot River. It is actually about a family's inability to help a member who is heading toward destruction, and about the inadequacy of love to save someone who won't be saved. Paul Maclean, the brother in the story, was a real person: he died in 1938, beaten to death in an alley in Chicago, a victim of gambling debts.

The prose of the novella — particularly its rhythms, which echo the casting motion it describes — became widely anthologized and quoted. The opening sentence — "In our family, there was no clear line between religion and fly fishing" — and the closing paragraph are among the most memorized passages in American literature produced after World War II.

## The Film and the River

Robert Redford's 1992 film adaptation, shot partly on the Gallatin River (standing in for the Blackfoot), introduced the story to an audience far beyond the literary world. It also created a tourism phenomenon: the Blackfoot River corridor, already a significant fishery, became a pilgrimage site. Montana Fish, Wildlife & Parks has worked for decades to protect the Blackfoot's water quality partly in response to the attention Maclean's work brought.

Norman Maclean died in 1990, two years before the film was released. He didn't live to see his meditation on a Missoula boyhood become a touchstone of American environmental and literary culture. The Clark Fork and the Blackfoot still run through the city. In June, when the snowmelt comes off the Mission Range and the rivers run high and green, the landscape Maclean described is entirely recognizable.`,
    sourceUrl: "https://en.wikipedia.org/wiki/A_River_Runs_Through_It_(novella)",
  },
  {
    headline: "The Higgins Avenue Bridge and the Block That Built Missoula's Downtown (1870s–1910s)",
    summary: `## The Crossing That Created Commerce

Every downtown has a geographic fact at its center — a river ford, a road junction, a harbor mouth — around which commerce organizes. For Missoula, that fact is the Clark Fork River crossing at Higgins Avenue. The street is named for Christopher Higgins, who, along with Frank Worden, built the original trading post in 1860 and then helped plat the town on the north bank of the Clark Fork. The avenue running south from their store to the river's edge became the commercial spine of the new city.

The first bridge over the Clark Fork at this location was a toll bridge, built in the early 1870s. It was a practical structure — wood, nothing ornamental — but its existence transformed the economics of settlement south of the river. The University district, the Rattlesnake neighborhood, and the working-class neighborhoods on the South Hills were all, in a sense, made possible by the ability to cross the Clark Fork without getting wet.

## The Higgins Block

Christopher Higgins built what is known as the Higgins Block at the corner of Higgins Avenue and Front Street in 1889, shortly before Montana achieved statehood. The structure — a two-story brick commercial building, typical of the Italianate commercial style then fashionable in western boom towns — housed the First National Bank of Missoula on its ground floor. It was, for its moment, the most prestigious commercial address in the city.

The Higgins Block still stands. It has been through many incarnations — bank, retail space, offices — and has survived the various floods and fires and redevelopment proposals that have claimed other nineteenth-century Missoula buildings. It is among the oldest surviving commercial structures in the city and represents the visual vocabulary of downtown Missoula before the automobile era transformed street design.

## Floods and Bridges

The Clark Fork has flooded Missoula repeatedly throughout its history, and the bridges across it are the recurring drama of those events. The 1908 flood — caused by an ice jam on the Clark Fork that backed water up through the city — reached downtown Missoula and damaged bridges and low-lying commercial buildings. Photographs from the flood show Higgins Avenue underwater to knee depth at the lower blocks.

The current Higgins Avenue Bridge dates to the 1960s and is a concrete structure without particular distinction. But its location — the same crossing Worden and Higgins identified in the 1860s — remains the axis around which Missoula's downtown is organized. Walk out to its center on a summer evening, look up the canyon toward the mouth of the Bitterroot, and you are standing at the geographic heart of a 160-year-old commercial decision.`,
    sourceUrl: "https://en.wikipedia.org/wiki/Missoula,_Montana#History",
  },
  {
    headline: "The Bonner Mill and the Timber Economy That Built Western Montana (1886–2008)",
    summary: `## Lumber and the Railroad

The Northern Pacific Railroad arrived in Missoula in 1883. It brought something the timber industry had always needed but never had in western Montana: a reliable, high-volume way to move wood to markets. Within three years, the first large-scale sawmill in the Clark Fork valley had been built at Bonner, a small community eight miles east of Missoula on the Blackfoot River, where the railroad crossed near a vast expanse of ponderosa pine, larch, and Douglas fir.

The Bonner Mill was established in 1886 and grew into one of the largest lumber operations in the Pacific Northwest. At its peak, the mill employed hundreds of workers and processed millions of board feet of timber annually, supplying lumber for the building booms that followed the railroad into every Montana community. The town of Bonner existed largely because the mill existed: company housing, a company store, and a social life organized around the rhythms of the shift schedule.

## The Anaconda Company and Industrial Timber

The Anaconda Copper Mining Company, which dominated Montana's economy from its Butte headquarters, eventually acquired the Bonner Mill in the early twentieth century and integrated it into a vertically organized empire that included copper mines, smelters, and the timber needed to shore up mine tunnels and build the infrastructure of extraction. At various points, Anaconda owned vast tracts of Montana forestland, much of it in the Blackfoot and Bitterroot drainages.

The relationship between the mill and the surrounding forest was not delicate. The logging methods of the early and middle twentieth century were aggressive — clearcuts on steep slopes, stream-bank logging that damaged fish habitat, roads cut without erosion controls. The Clark Fork and Blackfoot rivers downstream from Bonner accumulated decades of contamination from both mining and logging runoff.

## Closure and Cleanup

The Bonner Mill operated in various configurations through ownership changes across the twentieth century before finally closing in 2008. The closure ended 122 years of continuous timber milling on the Blackfoot and eliminated hundreds of union jobs in a rural community that had no obvious replacement employer.

The cleanup of the Bonner Mill site — and of the Clark Fork superfund corridor that runs from Warm Springs west past Missoula — has been a generational environmental project. Millions of dollars in remediation have gone into restoring river banks, removing contaminated soils, and reestablishing native vegetation on lands that spent a century being consumed for industrial purposes. The Blackfoot River, now a designated Wild and Scenic River, has recovered significantly. The mill site itself has been redeveloped as a housing and commercial development called the Millsite — a name that acknowledges what came before without quite celebrating it.`,
    sourceUrl: "https://en.wikipedia.org/wiki/Bonner,_Montana",
  },
  {
    headline: "Missoula's Streetcar Era: When Higgins Avenue Had Tracks in It (1910–1932)",
    summary: `## Electric Rails in a Mountain Town

Missoula operated an electric streetcar system from 1910 to 1932 — twenty-two years during which residents of the Rattlesnake, the South Hills, and the University District could board a car on Higgins Avenue and ride to work, to the university, or to Caras Park without owning a horse or an automobile. The system was never large — the route network covered only a few miles — but for the period when it operated, it was a genuine amenity of urban life in a mountain valley.

The Missoula Street Railway Company was incorporated in 1909 and began service in 1910, running a line from downtown south across the Higgins Avenue Bridge to the university campus. Additional routes followed, connecting the downtown core to residential neighborhoods on the Rattlesnake Creek drainage to the north and to the South Hills neighborhoods that were developing on the benchland above the Clark Fork.

## The Cars and the Infrastructure

The cars were single-truck electric streetcars typical of the period — small by the standards of larger cities, comfortable enough for a ten-minute urban commute. Power came from an electric substation fed by the hydroelectric potential of the Clark Fork drainage. The tracks were embedded in the paving of Higgins Avenue and the connecting streets, a visible reminder to automobile drivers (who were already beginning to outnumber streetcar riders by the late 1920s) that the streets had been built for multiple uses.

Maintenance shops and car storage occupied a facility on the east side of town. At the system's peak, the company operated a fleet of cars sufficient to maintain fifteen-minute headways on the main routes during peak hours — a standard of frequency that many modern American cities struggle to match with bus service.

## The Automobile and the End

The streetcar system's end came in 1932, during the depths of the Great Depression, when ridership had declined and the economics of maintenance no longer worked. The company ceased operations and the tracks were removed — as they were in hundreds of American cities during the same decade. The decision was financial rather than conspiratorial; the automobile had simply won the competition for urban space, and a small city in a mountain valley couldn't sustain the infrastructure costs of a rail system with a dwindling rider base.

The legacy of the streetcar era in Missoula is largely invisible. No tracks remain in the street surface; no cars survived. But the street grid that the system served — particularly the North Higgins corridor and the connection to the university — was shaped partly by the routes the streetcars ran. The city that grew up around those routes is still recognizable in the walkable, mixed-use neighborhoods that characterize the older parts of Missoula.`,
    sourceUrl: "https://en.wikipedia.org/wiki/Missoula,_Montana#History",
  },
];
