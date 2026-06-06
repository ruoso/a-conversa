# Example walkthrough

> Status: Demonstrative example. The substantive debate content (Anna's and Ben's positions on zoos) was originally produced by three independent sub-agents playing their roles in a simulated debate with neutral prompts. The platform-mechanics narration has since been updated to align with the current data model, methodology, architecture, and UI design docs. The walkthrough exercises the platform's procedure end-to-end.

## Setup

- **Topic**: "Should zoos exist?"
- **Debater A — Anna**: Defends the affirmative ("Zoos should exist").
- **Debater B — Ben**: Defends the negative ("Zoos should not exist").
- **Moderator — Maria**: Operates the platform.

Format conventions in the transcript below:

- Plain lines are spoken dialogue.
- `[bracketed lines]` are platform actions (events that land in the change history; what Maria does in the tool).
- Node IDs (`N1`, `N2`, ...) and edge IDs (`E1`, `E2`, ...) are assigned sequentially as entities are created. Decompositions and interpretive splits remove the parent and create components with **fresh IDs** (no sub-ID hierarchy); the parent → children relationship is recorded in the change history.
- Annotations have IDs `A1`, `A2`, ...
- Per-facet voting is implicit: the moderator's `commit` follows once all participants vote `agree` on each facet involved.

## Transcript

### 1. Show intro

MARIA: Good evening, and welcome to a-conversa. I'm Maria, your moderator. Tonight's question is one humans have been arguing about for over a century: should zoos exist? Defending the affirmative, Anna. Defending the negative, Ben. A quick reminder of how this works: I don't take sides — I run the board. Every time one of you makes a statement, I'll capture it as a node and propose a classification. Before anything is committed, all three of us — both of you plus me — have to agree on each facet (wording, kind, edges). If anyone disputes a classification, we have diagnostic tools for that. If one of you decides nothing could change your mind on a point, you can mark it as your axiom — that's a per-participant declaration of bedrock — and we route around it. The goal isn't to win. It's to find out exactly where you actually disagree.
`[platform: session-created (host: Maria, privacy: public). Board initialized; next IDs N1, E1, A1.]`

MARIA: Anna, the floor is yours. Open with your core position — one sentence if you can manage it. Ben, hold your response; I'll bring you in right after we've got Anna's opening on the board.

### 2. Anna opens

ANNA: Modern accredited zoos should exist because, on balance, they do more good than harm — they're a net positive for conservation, for public understanding of wildlife, and for the individual animals in their care.

### 3. Maria proposes decomposition + raises a definitional question

MARIA: Thanks, Anna. That's a useful opener, but it's doing a lot of work in one sentence — I want to unpack it before I commit anything.

MARIA: Anna, I'd like to propose decomposing your opener into a definitional node up front, an umbrella claim, and three supporting legs. That way when Ben pushes back, we'll know which leg he's pushing on. Two questions before I propose anything: First, does that decomposition feel faithful to what you meant, or am I flattening something? Second — and this matters for the definitional node — when you say "modern accredited zoos," is that a definitional move? Are roadside menageries and unaccredited operations simply outside the scope of what you're defending, by definition? Ben — hold your response.

### 4. Anna confirms scope

ANNA: The decomposition is faithful — those are exactly the three legs, and the umbrella rests on them. And yes, "modern accredited zoos" is definitional: I'm defending AZA-accredited institutions and their international equivalents, not roadside menageries or unaccredited operations.

### 5. Maria proposes N1–N5; flags the empirical-to-normative bridge

MARIA: Good — proposing all of that, definition first.

`[platform: propose-decomposition of Anna's utterance into:]`
- `[N1 (kind=definitional, owner=A): "Modern accredited zoos = AZA-accredited institutions and their international equivalents; roadside menageries and unaccredited operations are out of scope."]`
- `[N2 (kind=normative, owner=A): "Modern accredited zoos, on balance, do more good than harm." (umbrella claim)]`
- `[N3 (kind=normative, owner=A): "Modern accredited zoos are a net positive for conservation."]`
- `[N4 (kind=normative, owner=A): "Modern accredited zoos are a net positive for public understanding of wildlife."]`
- `[N5 (kind=normative, owner=A): "Modern accredited zoos are a net positive for the individual animals in their care."]`

`[platform: propose edges — E1: N3 supports N2; E2: N4 supports N2; E3: N5 supports N2. All in proposed state.]`

MARIA: Flagging for both of you: N2 through N5 are normative — they carry "should" or evaluative "net positive" language. That means at some point we'll need to surface the bridge from the empirical claims to the "should." Just marking it.

MARIA: Ben — over to you. Two questions before substance: One, do you accept N1's wording and classification as the scope of this debate, or do you want to contest the definitional frame? Two, do you accept the decomposition — N2 as the umbrella resting on N3, N4, N5 — as a faithful map of what you'll be responding to?

### 6. Ben accepts with annotation, pre-flags a new leg

BEN: On N1 — I accept it as the scope, but I want it logged that I think the accredited/unaccredited line does some argumentative work, because Anna gets to disown the worst cases without me getting to cite them; I'll live with that so long as we're both clear it's a narrowing, not a neutral definition. On the decomposition — yes, N3, N4, N5 under N2 is a fair map of Anna's case, and I'm content to argue inside it. One flag for later, not now: I'll want to add a leg of my own about the intrinsic cost of captivity, because I don't think it folds cleanly into N5 as welfare — but that's a proposal for when it's my turn to build, not an objection to the map as it stands.

### 7. Maria captures the annotation; queues the parking-lot leg; commits

MARIA: Logging Ben's acceptances with the annotation attached, so it doesn't get lost.

`[platform: propose annotation A1 on N1, kind=concern, owner=B, content: "Ben: scope-accepted; notes the accredited/unaccredited boundary does argumentative work — narrows what Anna defends and what Ben may cite. Visible to both."]`
`[platform: votes — Anna agree, Ben agree, Maria agree on each facet of N1 (wording, classification), N2-N5 (wording, classification), E1-E3 (shape), A1 (wording). Maria commits all.]`
`[platform: parking-lot note in change history — "Ben to propose new leg: intrinsic cost of captivity, distinct from N5 welfare."]`

MARIA: Anna, Ben's annotation on N1 is on the record — not a concession from you; just the boundary's argumentative work registered. Workable? Ben, when you build your leg, be ready for an operationalization pass — what makes "intrinsic cost of captivity" different in kind from welfare harms, not just in degree.

### 8. Anna confirms, Ben opens his leg

ANNA: Workable — I'm content to defend only AZA-accredited zoos and equivalents, and I accept that anything Ben cites from outside that boundary either doesn't touch my thesis or has to be bridged in explicitly.

BEN: I'll lay the captivity leg first — because it reframes how N3/N4/N5 get weighed. The claim: confinement of wide-ranging, cognitively complex animals imposes a morally significant cost on the individual that exists independently of welfare outcomes, and any conservation or education benefit has to be netted against that cost, not just against measurable welfare deficits. Once it's on the board, I'll come at N3 next, because I think the conservation case is where Anna's strongest ground actually is and I want to test it honestly.

### 9. Maria decomposes Ben's leg, runs operationalization + warrant elicitation

MARIA: Ben, that's compound. Let me propose a decomposition before we land it, and then we'll run operationalization on the part doing the heavy lifting.

`[platform: propose-decomposition of Ben's utterance into:]`
- `[N6 (kind=normative, owner=B): "Confinement-as-such imposes a morally significant cost on the individual."]`
- `[N7 (kind=normative, owner=B): "That cost is independent of measurable welfare outcomes and must enter the netting against benefits."]`
`[platform: propose edge E4: N7 qualifies N2 (Ben's cost claim qualifies the umbrella's net-benefit calculation). Status: proposed.]`

MARIA: Two structural things before substance.

First, operationalization on N6. It says there's a cost that exists *independently* of welfare outcomes — that's a strong move because it deliberately puts the cost outside what welfare science can measure.

`[platform: apply operationalization test to N6 — "What evidence would change your mind that confinement-as-such carries a cost over and above measurable welfare deficits? Is N6 defeasible, or do you want to propose an axiom-mark on N6 for yourself?"]`

MARIA: I'm genuinely open to either answer. If you want to propose an axiom-mark, we capture it and move on — that's a clean outcome, not a failure. If it's defeasible, I want to know on what.

Second, warrant. N6 is doing the heavy lifting; N7 follows from it. The warrant connecting "wide-ranging, cognitively complex" to "morally significant cost independent of welfare" needs to be visible.

`[platform: warrant elicitation triggered on N6 — moderator awaits the unstated bridge.]`

MARIA: Ben — operationalization and warrant, in that order. Then Anna.

### 10. Ben — N6 defeasible; names the warrant

BEN: On operationalization: N6 is defeasible, not axiomatic for me. I'd retract it if we had a robust account of animal interests on which "having one's range and behavioral repertoire structurally curtailed" reliably tracks no morally relevant interest once welfare indicators (stress, stereotypies, longevity, choice-tests) are clean — i.e., if revealed-preference and welfare science converged on showing well-managed captives have no remaining unmet interest, I'd drop the residual cost. On warrant: the bridge is interest-in-agency, not suffering. For animals whose cognitive and ecological profile is built around large-scale ranging, foraging decisions, and social navigation, confinement frustrates the exercise of capacities constitutive of their form of life, and frustration of constitutive capacities is a cost even when the organism has adapted enough that welfare metrics look acceptable — the same structure we accept for humans when we say a contented prisoner is still wronged.

### 11. Maria captures defeater + warrant chain

MARIA: Thank you, Ben. That's clarifying on both fronts. Capturing the defeater as a node with a pre-committed rebut, and capturing the warrant.

`[platform: capture defeater on N6 — create N8 (kind=predictive, owner=B): "Welfare science (stress markers, stereotypies, longevity, choice-tests) plus revealed-preference data converge on no remaining unmet interest in well-managed captives." Create rebut edge E5: N8 rebuts N6. Edge substance pre-committed by Ben as `agreed`; N8's own substance facet stays `proposed` (the condition isn't established). The defeater sits in the graph but doesn't currently fire — it would activate if N8 were ever substantively established.]`

`[platform: capture warrant — create N9 (kind=normative, owner=B): "Frustration of capacities constitutive of an animal's form of life is a moral cost, even when standard welfare metrics are acceptable." Create N10 (kind=fact, owner=B): "The species at issue have cognitive/ecological profiles organized around ranging, foraging choice, and social navigation such that confinement frustrates those capacities." Propose edges — E6: N9 bridges-from N10 (warrant draws on this empirical data); E7: N9 bridges-to N6 (warrant licenses the cost claim). N9 + N10 together act as the warranted inference for N6.]`

MARIA: So the structure now is: N6 rests on N9 (the agency/constitutive-capacities principle) plus N10 (an empirical claim about what these animals' capacities actually are), with N9 bridging from data to claim. That's useful — it gives us two distinct places the disagreement could live. Ben, one quick check before I turn to Anna. The prisoner analogy is doing real work in N9. Is N9 freestanding for you — you'd hold it on its own — or is it derived from something more general?

### 12. Ben — N9 isn't bedrock; points to capabilities + an axiom further down

BEN: Honestly, N9 isn't my bedrock — it's downstream of something like a capabilities view, roughly Nussbaum-flavored: that there's a form of flourishing proper to a kind of creature, and frustrating the capacities constitutive of it is a harm even when the creature is comfortable. I won't pretend I've worked out the metaethics under that; if you push hard enough you'll hit something I'd call axiomatic — that a life has a shape it's owed, and thwarting that shape counts morally — but the capabilities framing is where I actually reason from, not just a label I'm reaching for.

### 13. Maria captures the chain N9 ← N11 ← N12

MARIA: Thank you, Ben — that's exactly the kind of unpacking that helps. So we have a chain: N9 rests on a capabilities-style view, and below that, if pushed, something like "a life has a shape it's owed."

`[platform: create N11 (kind=normative, owner=B): "A creature has a form of flourishing proper to its kind; frustrating capacities constitutive of that form is morally significant harm, independent of subjective welfare." Tag: capabilities-frame.]`
`[platform: propose edge E8: N11 supports N9.]`
`[platform: create N12 (kind=normative, owner=B): "A life has a shape it is owed; thwarting that shape counts morally." Marked candidate-axiom — Ben to confirm whether to propose an axiom-mark.]`
`[platform: propose edge E9: N12 supports N11.]`

MARIA: Ben, two checks before I hand back to Anna. First — do you want to propose an axiom-mark on N12 for yourself, or would you rather we leave it as a regular node with N11 as your working commitment? I just want the board honest about where the reasoning bottoms out. Second — and this matters for what Anna can engage with — is N11 defeasible the way N6 is?

### 14. Ben — proposes axiom-mark on N12; lists N11 defeaters

BEN: On (1): yes, propose an axiom-mark on N12 for me — that's my floor. I can't give you a non-circular argument for "a life has a shape it's owed"; anything I'd offer in support already presupposes it. On (2): N11 is genuinely defeasible — I'd move off the capabilities frame if someone showed the notion of "form of life" doesn't carve nature at the joints, or that every case I'd call capability-frustration reduces without remainder to subjective welfare deficits. So the disagreement with a pure welfarist probably is a difference in starting frame at N12, but the framework I've built on top of it (N11) is still answerable to argument.

### 15. Maria captures Ben's axiom-mark; captures N11 defeaters

MARIA: Recording both moves.

`[platform: propose axiom-mark on N12 by Ben. Per-participant — Ben's bedrock; Anna has not marked.]`
`[platform: capture N11 defeaters as nodes:]`
- `[N13 (kind=predictive, owner=B): "The notion of 'kind-constitutive capacities' fails to survive philosophy-of-biology scrutiny." Rebut edge E10: N13 rebuts N11. Edge substance pre-committed agreed by Ben; N13's substance stays proposed.]`
- `[N14 (kind=normative, owner=B): "Capability-frustration reduces without remainder to welfare deficits in every case." Rebut edge E11: N14 rebuts N11. Edge substance pre-committed agreed by Ben; N14's substance stays proposed.]`

MARIA: A note on what just changed structurally. With Ben's axiom-mark proposed on N12, we've isolated where argument stops and frame begins for him. Disagreement below N12 won't be resolved by more evidence; disagreement above it can be.

MARIA: Anna, two questions, in order. First, on N12: do you accept it (in which case you may want to propose your own axiom-mark on N12 — axiom-marks are per-participant, so both of you can hold the same node as bedrock from your respective frames), reject it, or want to mark a different competing axiom for yourself? Second, on N11: Ben has handed you two pre-committed defeaters (N13 and N14). If you want to contest N11 without going all the way down to N12, those are the openings.

### 16. Anna — proposes her own axiom-mark on N12; pushes on N14 with an epistemic flip

ANNA: I won't reject N12 — I think Ben's right that lives have shapes, and pretending otherwise to win a debate would be dishonest. I'm proposing an axiom-mark on N12 for myself too. But I want to push on N14, because I think the reduction goes the other way than Ben assumes: when we identify a "constitutive capacity," our evidence that it's constitutive is almost always that frustrating it produces suffering, stereotypy, shortened lives, or developmental failure in the creatures themselves. So N11 isn't independent of welfare — welfare is how we know which capacities count. That doesn't dissolve the moral cost in N6, but it does mean the cost lives on a scale AZA husbandry can actually move, which is where I want the netting argument to happen.

### 17. Maria commits both axiom-marks; interpretively splits N14; logs Anna's reframe as a contested meta-move

MARIA: Anna, before I let Ben respond, let me get this onto the board — there's a lot moving at once and I want the audience to see the structure.

`[platform: votes lock — all participants agree on Ben's axiom-mark on N12 (we agree this is Ben's bedrock, not that N12 is true); Maria commits. All participants then agree on Anna's axiom-mark on N12 for Anna; Maria commits. Two axiom-marks on N12, one per debater. Annotation for audience: shared axiom — both debaters now hold N12 as bedrock from their respective frames. The disagreement is no longer whether lives have shapes that can be wronged — it's how we know which shapes, and what follows.]`

MARIA: First, Anna, I want to name what you just did, because it's the kind of move the platform is built to surface. You didn't reject Ben's axiom — you accepted it and then attacked the inference he draws from it. That changes the terrain.

`[platform: create N15 (kind=fact, owner=A): "Our evidence that a capacity is constitutive of a kind's flourishing is, in nearly all cases, that frustrating it produces welfare deficits — suffering, stereotypy, shortened lifespan, developmental failure." Note: this is initially read as supporting an epistemic reading of N14, not necessarily the metaphysical one.]`

MARIA: I want to be careful here, because I heard two things and I think they need separate lines on the board. One is epistemic — how we *identify* constitutive capacities. The other is metaphysical — whether those capacities, once identified, are *just* welfare in disguise. Ben's N11 needs the metaphysical version to fail; Anna's argument so far only clearly establishes the epistemic. So I'm proposing an interpretive split on N14.

`[platform: propose interpretive-split on N14 into:]`
- `[N16 (kind=predictive, owner=B): "Welfare deficits are our evidence for constitutive capacities" (epistemic reading).]`
- `[N17 (kind=normative, owner=B): "Capability-frustration just IS welfare loss, ontologically" (metaphysical reading).]`
`[platform: when split commits, N14 is removed from the visible graph; N16 and N17 take its place, each with rebut edges to N11 (E11a: N16 rebuts N11; E11b: N17 rebuts N11), each with edge substance pre-committed agreed by Ben (carries from N14's pre-commitment); N16's and N17's own substance stays proposed.]`
`[platform: propose edge E12: N15 supports N16 (Anna's claim supports the epistemic reading).]`

MARIA: And the third thing — the strategic one — I want logged explicitly so neither of you can quietly relocate the debate later.

`[platform: capture meta-move (kind=reframe) by Anna as annotation A2 on N6: "If welfare is the access to constitutive capacities, then the netting question — does AZA-grade husbandry sufficiently meet ranging/foraging/social-navigation capacities — is the operational form of the constitutive-capacities dispute, not a sidestep of it." A2 status: proposed (Ben has not voted agree on this reframe).]`

MARIA: So, Anna, one operationalization question before Ben replies, because I want N15 to be something the platform can actually work with. You said "almost always." Can you name a case where we'd call a capacity constitutive *without* welfare-deficit evidence? If there are none, N15 strengthens the epistemic reading. If there are some, that's where Ben will plant his flag.

### 18. Anna — candidate counterexamples, conceded as thin

ANNA: Honestly, I can think of a few candidates, though none are knockdown. Reproductive and developmental capacities are one: we describe a salmon's life-shape as including the spawning run even for hatchery fish that seem behaviorally fine without it, and we call a tree "stunted" by its bonsai pot without invoking suffering. Social structure is another — we say a wolf pack has a form even when individual welfare metrics on a solitary captive look acceptable. So I think the metaphysical reading has some independent grip, but I'll concede it's thin grip: in each case a skeptic can reasonably ask whether we're tracking something real or just projecting a species-narrative, and I don't yet have a clean way to answer that.

### 19. Maria asks for a discriminator

MARIA: Anna, that's a useful concession — three candidate cases, none decisive, and you've named the worry yourself: are we tracking a real joint or telling a species-shaped story? Let me put that on the board so the disagreement is properly located.

`[platform: create N18 (kind=fact, owner=A): "Candidate constitutive-but-welfare-neutral capacities exist (hatchery salmon spawning run; wolf pack structure under solitary captivity with intact welfare metrics; bonsai-style developmental truncation absent suffering) — but each is contestable and may reflect species-narrative projection rather than a natural joint."]`
`[platform: propose edge E13: N18 qualifies N17 (the metaphysical reading is the one N18 is pressuring; if any candidate survives scrutiny, capability-frustration cannot just BE welfare loss).]`
`[platform: propose edge E14: N15 supports N18 (the epistemic worry Anna already granted is exactly the projection worry resurfacing).]`

MARIA: Before we go to Ben — Anna, the skeptic's challenge you raised against yourself is the load-bearing one. Can you name what evidence, in principle, would distinguish "tracking a real kind-constitutive capacity" from "projecting a species-narrative onto welfare-fine animals"? Even a sketch. If there's no possible discriminator, N17 is unfalsifiable from this side — important to mark. If there is one, it becomes the operational test for the whole N11 dispute.

### 20. Anna — convergence sketch; concedes N17 unfalsifiable from her side

ANNA: Honestly, the cleanest sketch I can offer is convergence: if independent lineages or independently-reared individuals, with no shared training or narrative scaffolding, reliably reorganize toward the same capacity-expression when given the chance — and its absence predicts downstream dysfunction we weren't already cued to look for — that's some traction against pure projection. But I'll concede that's an epistemic discriminator, not a metaphysical one; it tells us when to bet on a kind-constitutive capacity, not that frustration *is* welfare-loss independent of evidence. So for N17 specifically, I don't have a discriminator that holds up, and Maria is right to mark it unfalsifiable from my side until I produce one.

### 21. Ben — refuses to press the conceded point; locates the live disagreement at the reframe

BEN: I'm contesting the reframe (annotation A2), and I want to be clean about why: Anna's concession on N17 is the right one, and I'm not going to press an opponent who's already admitted her version of the claim is unfalsifiable from her side — that would be scoring points, not thinking. N16 I actually accept; welfare deficits are how we detect constitutive frustration, and I don't need that to be a competing theory. The live disagreement is the reframe: I don't grant that "access to constitutive capacities" collapses into the husbandry-netting question, because the AZA frame still treats capacity-expression as an input to welfare optimization rather than as something owed independently — and N12, which Anna has accepted, is precisely the claim that owing comes first. So the netting debate isn't the operational form of N11; it's what N11 looks like after you've already quietly demoted it.

### 22. Maria locates the crux as N19; segment recap

MARIA: Ben, let me make sure I've got that. You're not retreating — you're objecting to the shape of the room. You accept N16 outright: welfare measurements are how we detect constitutive frustration, full stop, no competing theory needed. And you're declining to push N17 even though Anna conceded it, because winning an unfalsifiable point isn't thinking. Fine. The actual fight, you're saying, is the reframe itself — that translating this into "AZA-husbandry netting" treats capacity-expression as an input to a welfare calculation, and that quietly demotes N12. Owing comes first; netting comes after. So the netting question isn't the operational form of N11 — it's what N11 looks like after N12 has already been smuggled out of the priority slot.

`[platform: log Ben's stance updates:]`
- `[Ben votes agree on N16 substance (accepts the epistemic reading); all parties agree; Maria commits N16 substance as agreed. The epistemic-reading rebut on N11 is now substantively live too: edge E11a's substance is already agreed (Ben's pre-commitment), and now N16's substance is agreed, so the rebut on N11 fires through this path.]`
- `[Capture annotation A3 on N17, kind=stance, owner=B, content: "Decline to press despite available concession; methodological, not substantive." A3 commits.]`
- `[Ben votes dispute on annotation A2 (Anna's reframe). A2 stays in disputed state.]`
`[platform: create N19 (kind=normative, owner=B): "What is owed — that a life has a shape it is owed — precedes welfare-aggregation; the netting question is downstream of that priority, not its operational form." Propose contradicts edge E15: N19 contradicts A2 (Anna's reframe). Status: live disagreement. N19 is the located crux.]`

MARIA: And that's the segment. Look at where we started and where we are. Anna came in with a three-legged defense of accredited zoos — conservation, public understanding, individual welfare. Ben came in with a capabilities objection. An hour in, almost everything on the board is shared. N12 — that a life has a shape it is owed — is shared (axiom-marked by both debaters from their respective frames). N16 — that welfare metrics are the instrument for detecting frustrated capacities — is shared. N17 (the metaphysical version) is parked, by mutual agreement, as unfalsifiable from here.

MARIA: What's left is sharp and small and real: when we ask whether a particular zoo is doing right by a particular animal, does owing come first and welfare-accounting come second — or do they enter the calculation together? That is the disagreement. Everything else was scaffolding to find it.

MARIA: After the break: we put N19 to them directly. Anna, does the reframe demote N12, or does it operationalize it? Ben, if owing is lexically prior, what does that look like at an actual enclosure on an actual Tuesday? Same table, same tool, narrower question. Stay with us.

`[platform: snapshot-created — label "Segment 1 close"; current event-log position recorded for replay reference.]`

## What the example demonstrated

The walkthrough exercises most of the platform's core mechanics:

- **Decomposition** — applied at multiple scales: the opening compound claim (turn 5), the structural splitting of Ben's captivity claim into N6 and N7 (turn 9). Decomposition removes the parent and creates components with **fresh IDs**; the parent → children relationship is recorded in the change history.
- **Definitional scoping with annotations** — N1 logged up front, with annotation A1 capturing Ben's note that the boundary itself does argumentative work (turn 5–7). Annotations are first-class on agreed nodes and go through the standard agreement workflow.
- **Operationalization test** — applied to N6 (turn 9) and triggered the axiom-mark question on N12 (turn 13–15), with different outcomes: defeasible vs. axiom-marked.
- **Warrant elicitation** — Maria asked Ben to name the bridge from species capacities to moral cost; he named "interest-in-agency" (turn 9–11). Captured as N9 (warrant) bridging from N10 (data) to N6 (claim) via two directed edges (`bridges-from`, `bridges-to`).
- **Defeater capture** — Ben offered specific defeaters for N6 (N8) and for N11 (N13, N14) (turn 11, 14–15). Each defeater is a regular node with a `rebuts` edge whose substance is pre-committed `agreed` while the defeater node's own substance stays `proposed` — the pattern that lets a defeater sit in the graph without firing until its source becomes substantively established (the conditional reading of edge substance).
- **Per-participant axiom-marks** — Ben proposed an axiom-mark on N12 for himself (turn 14). Anna later proposed her own axiom-mark on N12 (turn 16) — two participant-specific marks on the same node, an unanticipated structural finding (shared bedrock from different frames).
- **Interpretive split** — Maria split N14 into N16 (epistemic reading) and N17 (metaphysical reading) (turn 17), preserving the force of Anna's argument only on the reading her evidence actually covers.
- **Capturing meta-moves** — Anna's "reframe" (turn 16) was explicitly logged as annotation A2 with kind=reframe, so it couldn't be quietly used to relocate the debate. Once contested by Ben (turn 21), A2 stays visible as `disputed`.
- **Methodological stance annotation** — Ben's "decline to press" was captured as annotation A3 on N17 with kind=stance (turn 22) — recording his methodological position separately from any substantive claim.
- **Discriminator elicitation** — Maria pressed Anna for a falsifiability criterion on N18; Anna offered a sketch and explicitly conceded its limits (turn 19–20).
- **Locating the actual crux** — N19 (lexical priority of owing vs. welfare-aggregation) emerged as the located disagreement after roughly 20 turns of structural work (turn 22). Captured with a `contradicts` edge to A2. Neither debater would have named this as the crux at the start.
- **Refusing to score points** — Ben declined to press a concession Anna had made because doing so would be "scoring points, not thinking" (turn 21). The format rewards finding the disagreement, not winning the round; a stance annotation makes this visible structurally.
- **Segment snapshot** — Maria called for a snapshot at the segment break (turn 22), naming a position in the event log for replay reference.
