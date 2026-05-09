# Example walkthrough

> Status: Demonstrative example. The dialogue below was produced by three independent sub-agents (Anna, Ben, Maria) playing their roles in a simulated debate, orchestrated turn-by-turn with neutral prompts (each agent received only their position, the platform rules, and the transcript so far — they were never told what move to make). The walkthrough exercises the platform's procedure end-to-end.

## Setup

- **Topic**: "Should zoos exist?"
- **Debater A — Anna**: Defends the affirmative ("Zoos should exist").
- **Debater B — Ben**: Defends the negative ("Zoos should not exist").
- **Moderator — Maria**: Operates the platform.

Format conventions in the transcript below:
- Plain lines are spoken dialogue.
- `[bracketed lines]` are platform actions (what Maria does in the tool).
- Node IDs (`N1`, `N2`, ...) and edge IDs (`E1`, `E2`, ...) are assigned as they appear.

## Transcript

### 1. Show intro

MARIA: Good evening, and welcome to a-conversa. I'm Maria, your moderator. Tonight's question is one humans have been arguing about for over a century: should zoos exist? Defending the affirmative, Anna. Defending the negative, Ben. A quick reminder of how this works: I don't take sides. I run the board. Every time one of you makes a statement, I'll log it as a node. Before anything moves forward, you both have to agree on how it gets classified — fact, value, predictive, normative, or definitional. If you can't agree, we have tools for that. If one of you decides nothing could change your mind on a point, we mark it an axiom and route around it. The goal isn't to win — it's to find out exactly where you actually disagree.
`[platform: board initialized, empty graph, next IDs N1, E1]`

MARIA: Anna, the floor is yours. Open with your core position — one sentence if you can manage it. Ben, hold your response; I'll bring you in right after we've got Anna's opening node on the board.

### 2. Anna opens

ANNA: Modern accredited zoos should exist because, on balance, they do more good than harm — they're a net positive for conservation, for public understanding of wildlife, and for the individual animals in their care.

### 3. Maria proposes decomposition + raises a definitional question

MARIA: Thanks, Anna. That's a useful opener, but it's doing a lot of work in one sentence — I want to unpack it before we log anything, because I suspect there are at least three separable claims in there.
`[platform: provisional capture]`
`[platform: N1-draft "Modern accredited zoos, on balance, do more good than harm" — kind: TBD]`
`[platform: N2-draft "Zoos are a net positive for conservation"]`
`[platform: N3-draft "Zoos are a net positive for public understanding of wildlife"]`
`[platform: N4-draft "Zoos are a net positive for the individual animals in their care"]`

MARIA: Anna, I'd like to propose decomposing your opener into those four nodes — the umbrella claim plus the three sub-claims it rests on. That way when Ben pushes back, we'll know which leg he's pushing on. Two questions before we commit anything to the board: First, Anna — does that decomposition feel faithful to what you meant, or am I flattening something? Second — and this one matters for classification — when you say "modern accredited zoos," is that a definitional move? Meaning: are roadside menageries and unaccredited operations simply outside the scope of what you're defending, by definition? If yes, we should log that as a definitional node up front so Ben knows what target he's aiming at. Ben — hold your response.

### 4. Anna confirms scope

ANNA: The decomposition is faithful — those are exactly the three legs, and the umbrella rests on them. And yes, "modern accredited zoos" is definitional: I'm defending AZA-accredited institutions and their international equivalents, not roadside menageries or unaccredited operations — those are outside my scope, and I'd want that logged up front.

### 5. Maria lands D1 + N1–N4, flags the empirical-to-normative bridge

MARIA: Good — I'll log all of that. Definition first, then the decomposition, so the scope of the debate is clear before Ben responds to anything.
`[platform: log D1 (definitional) — "Modern accredited zoos" = AZA-accredited institutions and their international equivalents; roadside menageries and unaccredited operations are out of scope. Status: pending Ben's agreement.]`
`[platform: log N1 (normative, umbrella) — "Modern accredited zoos should exist because, on balance, they do more good than harm." Status: pending Ben's agreement on the decomposition.]`
`[platform: log N2 (normative) — "Modern accredited zoos are a net positive for conservation."]`
`[platform: log N3 (normative) — "Modern accredited zoos are a net positive for public understanding of wildlife."]`
`[platform: log N4 (normative) — "Modern accredited zoos are a net positive for the individual animals in their care."]`
`[platform: register edges N2 supports N1, N3 supports N1, N4 supports N1. Status: all pending Ben's agreement.]`

MARIA: Flagging for both of you: N1 through N4 are normative — they carry "should" or evaluative "net positive" language. That means at some point we'll need to surface the bridge from the empirical claims to the "should." I'm not asking for that yet; just marking it.

MARIA: Ben — over to you. Two questions before we go anywhere on substance: One, do you accept D1 as the scope of this debate, or do you want to contest the definitional frame? If you think the AZA-accredited / unaccredited line is itself doing argumentative work, say so now and we'll log that as a meta-disagreement rather than letting it sit underneath everything. Two, do you accept the decomposition — N1 as the umbrella resting on N2, N3, and N4 as its three legs — as a faithful map of what you'll be responding to?

### 6. Ben accepts with annotation, pre-flags a new leg

BEN: On D1 — I'll accept it as the scope, but I want it logged that I think the accredited/unaccredited line does some argumentative work, because Anna gets to disown the worst cases without me getting to cite them; I'll live with that so long as we're both clear it's a narrowing, not a neutral definition. On the decomposition — yes, N2, N3, N4 under N1 is a fair map of Anna's case, and I'm content to argue inside it. One flag for later, not now: I'll want to add a leg of my own about the intrinsic cost of captivity, because I don't think it folds cleanly into N4 as welfare — but that's a proposal for when it's my turn to build, not an objection to the map as it stands.

### 7. Maria preserves the annotation, queues the parking-lot leg

MARIA: Logging Ben's acceptances with the caveats attached, so they don't get lost.
`[platform: D1 status → accepted, with annotation "Ben: scope-accepted; notes that the accredited/unaccredited boundary does argumentative work — narrows what Anna defends and what Ben may cite. Annotation visible to both."]`
`[platform: decomposition N1{N2,N3,N4} → accepted by both.]`
`[platform: parking-lot entry P1 — "Ben to propose new leg: intrinsic cost of captivity, distinct from N4 welfare. Queued for Ben's build turn."]`

MARIA: Two flags before we move. First, Anna — Ben's annotation on D1 is on the record, not a concession from you; it just means if a case sits outside AZA-equivalent accreditation, it's out of scope for both sides. Workable? Second, on the parking-lot leg: Ben, when you build it, be ready for an operationalization pass — what makes "intrinsic cost of captivity" different in kind from welfare harms, not just in degree. That's the line that'll keep it from collapsing into N4. Assuming Anna's good with the D1 annotation, Ben has the build.

### 8. Anna confirms, Ben opens his leg

ANNA: Workable — I'm content to defend only AZA-accredited zoos and equivalents, and I accept that anything Ben cites from outside that boundary either doesn't touch my thesis or has to be bridged in explicitly.

BEN: I'll lay the captivity leg first — call it N5 — because it reframes how N2/N3/N4 get weighed. The claim: confinement of wide-ranging, cognitively complex animals imposes a morally significant cost on the individual that exists independently of welfare outcomes, and any conservation or education benefit has to be netted against that cost, not just against measurable welfare deficits. Once N5 is on the board, I'll come at N2 next, because I think the conservation case is where Anna's strongest ground actually is and I want to test it honestly.

### 9. Maria splits N5, applies operationalization + warrant elicitation

MARIA: Ben, before we let you swing at N2, I want to land N5 cleanly so it doesn't drift while we're arguing elsewhere.
`[platform: classify N5 as normative]`
`[platform: annotate N5 — "two-part structure: (a) confinement-as-such imposes a morally significant cost on the individual; (b) that cost is independent of measurable welfare outcomes and must enter the netting"]`

MARIA: Two quick structural things before substance. First, operationalization — and I'm asking this of the claim, not of you personally, Ben. N5(a) says there's a cost that exists independently of welfare outcomes. That's a strong move because it deliberately puts the cost outside what welfare science can measure.
`[platform: apply operationalization test to N5 — "What would change your mind that confinement-as-such carries a cost over and above measurable welfare deficits? Is there any empirical or conceptual finding that would retract N5(a), or is N5(a) functioning as an axiom for you?"]`

MARIA: I'm genuinely open to either answer. If it's an axiom, we mark it and move on — that's a clean outcome, not a failure. If it's defeasible, I want to know on what. Second, warrant. N5(a) is doing the heavy lifting; N5(b) follows from it. The warrant connecting "wide-ranging, cognitively complex" to "morally significant cost independent of welfare" needs to be visible.
`[platform: request warrant W-N5 — the bridge from species-level capacities to an individual-level moral cost not reducible to welfare measurement]`

MARIA: Ben — operationalization and warrant, in that order. Then Anna.

### 10. Ben answers — N5(a) defeasible, names the warrant

BEN: On operationalization: N5(a) is defeasible, not axiomatic. I'd retract it if we had a robust account of animal interests on which "having one's range and behavioral repertoire structurally curtailed" reliably tracks no morally relevant interest once welfare indicators (stress, stereotypies, longevity, choice-tests) are clean — i.e., if revealed-preference and welfare science converged on showing well-managed captives have no remaining unmet interest, I'd drop the residual cost. On warrant: the bridge is interest-in-agency, not suffering. For animals whose cognitive and ecological profile is built around large-scale ranging, foraging decisions, and social navigation, confinement frustrates the exercise of capacities constitutive of their form of life, and frustration of constitutive capacities is a cost even when the organism has adapted enough that welfare metrics look acceptable — the same structure we accept for humans when we say a contented prisoner is still wronged.

### 11. Maria captures warrant; surfaces N6 + N7

MARIA: Thank you, Ben. That's clarifying on both fronts.
`[platform: update N5(a) — mark defeasible: true; attach retraction condition: "welfare science (stress markers, stereotypies, longevity, choice-tests) plus revealed-preference data converge on no remaining unmet interest in well-managed captives"]`
`[platform: add N6 (normative): "Frustration of capacities constitutive of an animal's form of life is a moral cost, even when standard welfare metrics are acceptable."]`
`[platform: add N7 (fact, empirical-conditional): "The species at issue have cognitive/ecological profiles organized around ranging, foraging choice, and social navigation such that confinement frustrates those capacities."]`
`[platform: add edge — N6 + N7 bridges → N5(a) (warrant elicited)]`
`[platform: tag N6 as candidate axiom-or-derivable; flag for disputation test]`

MARIA: So the structure now is: N5(a) rests on N6 (the agency/constitutive-capacities principle) plus N7 (an empirical claim about what these animals' capacities actually are). That's useful — it gives us two distinct places the disagreement could live. Ben, one quick check before I turn to Anna. The prisoner analogy is doing real work in N6. Is N6 freestanding for you — you'd hold it on its own — or is it derived from something more general (a Nussbaum-style capabilities view, a Kantian-adjacent dignity claim, something else)? I'm trying to see whether N6 is your stopping point or whether there's a layer beneath it.

### 12. Ben — N6 isn't bedrock, points to capabilities + an axiom further down

BEN: Honestly, N6 isn't my bedrock — it's downstream of something like a capabilities view, roughly Nussbaum-flavored: that there's a form of flourishing proper to a kind of creature, and frustrating the capacities constitutive of it is a harm even when the creature is comfortable. I won't pretend I've worked out the metaethics under that; if you push hard enough you'll hit something I'd call axiomatic — that a life has a shape it's owed, and thwarting that shape counts morally — but the capabilities framing is where I actually reason from, not just a label I'm reaching for.

### 13. Maria captures the chain N6 → N8 → N9

MARIA: Thank you, Ben — that's exactly the kind of unpacking that helps. So we have a chain: N6 rests on a capabilities-style view of flourishing, and below that, if pushed, something like "a life has a shape it's owed."
`[platform: add N8 (normative, Ben): a creature has a form of flourishing proper to its kind; frustrating capacities constitutive of that form is morally significant harm, independent of subjective welfare. Tag: capabilities-frame.]`
`[platform: add edge N8 bridges → N6 (warrant: N6 is the application of N8 to confinement-frustrated capacities).]`
`[platform: add N9 (normative, Ben, candidate axiom): a life has a shape it is owed; thwarting that shape counts morally. Marked provisional-axiom, pending Ben's endorsement.]`
`[platform: add edge N9 bridges → N8.]`

MARIA: Ben, two quick checks before I hand back to Anna. First — is N9 the floor for you, or would you rather we leave it as "candidate axiom" and keep N8 as your working commitment? I don't want to pin you to metaethics you haven't endorsed; I just want the board honest about where the reasoning bottoms out. Second — and this matters for what Anna can engage with — is N8 defeasible the way N5(a) is? Once you answer that, Anna, I'll turn to you — not to litigate N8, but to ask whether you accept the capabilities frame, reject it, or work from a different normative frame entirely.

### 14. Ben — N9 is the floor; N8 is defeasible

BEN: On (1): N9 is the floor — mark it as axiom, not candidate. I can't give you a non-circular argument for "a life has a shape it's owed"; anything I'd offer in support already presupposes it. On (2): N8 is genuinely defeasible — I'd move off the capabilities frame if someone showed the notion of "form of life" doesn't carve nature at the joints (e.g., that "capacities constitutive of a kind" dissolves under serious scrutiny in philosophy of biology), or that every case I'd call capability-frustration reduces without remainder to subjective welfare deficits. So the disagreement with a pure welfarist probably is a difference in starting frame at N9, but the framework I've built on top of it (N8) is still answerable to argument.

### 15. Maria marks N9 as axiom; logs N8 defeaters; brings Anna in

MARIA: Recording both moves.
`[platform: mark N9 as axiom (Ben). Annotation: "starting-frame commitment; Ben declines to offer non-circular support."]`
`[platform: mark N8 status normative, defeasible (Ben). Defeaters logged: (D8a) "kind-constitutive capacities" fails to survive philosophy-of-biology scrutiny; (D8b) capability-frustration reduces without remainder to welfare deficits in every case.]`

MARIA: A note on what just changed structurally. N9 is now a declared floor on Ben's side, which means we've isolated where argument stops and frame begins for him. That's useful — disagreement below N9 won't be resolved by more evidence, and disagreement above it can be.
`[platform: flag potential meta-disagreement candidate at N9, pending Anna's response. Not asserted yet.]`

MARIA: Anna, two questions, in order. First, on N9 itself: do you accept it, reject it, or want to mark your own competing axiom? "A life has a shape it is owed" is the claim. If we end up with two axioms that don't reduce to each other, that's a meta-disagreement, and the conversation's job changes. Second, on N8: Ben has handed you two defeaters he'd accept. If you want to contest N8 without going all the way down to N9, those are the openings. Your move.

### 16. Anna — accepts N9; pushes on D8b with an epistemic flip

ANNA: I won't reject N9 — I think Ben's right that lives have shapes, and pretending otherwise to win a debate would be dishonest. But I want to push on D8b, because I think the reduction goes the other way than Ben assumes: when we identify a "constitutive capacity," our evidence that it's constitutive is almost always that frustrating it produces suffering, stereotypy, shortened lives, or developmental failure in the creatures themselves. So N8 isn't independent of welfare — welfare is how we know which capacities count. That doesn't dissolve the moral cost in N5(a), but it does mean the cost lives on a scale AZA husbandry can actually move, which is where I want the netting argument to happen.

### 17. Maria splits D8b epistemic/metaphysical; logs Anna's reframe as a contested meta-move

MARIA: Anna, before I let Ben respond, let me get this onto the board — there's a lot moving at once and I want the audience to see the structure.
`[platform: log AGREE(Anna, N9). Annotate: shared axiom between Ben and Anna. Flag for audience: "Both debaters now accept N9 as axiomatic. The disagreement is no longer whether lives have shapes that can be wronged — it's how we know which shapes, and what follows."]`

MARIA: First, Anna, I want to name what you just did, because it's the kind of move the platform is built to surface. You didn't reject Ben's axiom. You accepted it and then attacked the inference he draws from it. That changes the terrain.
`[platform: open node E1 Anna (epistemic, kind=fact-ish): "Our evidence that a capacity is constitutive of a kind's flourishing is, in nearly all cases, that frustrating it produces welfare deficits — suffering, stereotypy, shortened lifespan, developmental failure."]`
`[platform: edge E1 supports D8b. Note: this is not yet a reduction claim; it's an access claim.]`

MARIA: I want to be careful here, because I heard two things and I think they need separate lines on the board. One is epistemic — how we *identify* constitutive capacities. The other is metaphysical — whether those capacities, once identified, are *just* welfare in disguise. Ben's N8 needs the second to fail. Your move so far only clearly establishes the first.
`[platform: split D8b into D8b-epistemic ("welfare deficits are our evidence for constitutive capacities") and D8b-metaphysical ("capability-frustration just IS welfare loss, ontologically"). Mark D8b-epistemic as live and supported by E1. Mark D8b-metaphysical as not-yet-argued.]`

MARIA: And the third thing — the strategic one — I want logged explicitly so neither of you can quietly relocate the debate later.
`[platform: log Anna's reframe as a meta-move, not a substantive node: "If welfare is the access to constitutive capacities, then the netting question — does AZA-grade husbandry sufficiently meet ranging/foraging/social-navigation capacities — is the operational form of the N8 dispute, not a sidestep of it." Flag: contested. Ben has not accepted this reframe.]`

MARIA: So, Anna, one operationalization question before Ben replies, because I want E1 to be something the platform can actually work with rather than a slogan. You said "almost always." Can you name a case where we'd call a capacity constitutive *without* welfare-deficit evidence? If there are none, E1 strengthens. If there are some, that's where Ben will plant his flag, and I'd rather we find that edge now than in twenty minutes.

### 18. Anna — candidate counterexamples, conceded as thin

ANNA: Honestly, I can think of a few candidates, though none are knockdown. Reproductive and developmental capacities are one: we describe a salmon's life-shape as including the spawning run even for hatchery fish that seem behaviorally fine without it, and we call a tree "stunted" by its bonsai pot without invoking suffering. Social structure is another — we say a wolf pack has a form even when individual welfare metrics on a solitary captive look acceptable. So I think the metaphysical reading has some independent grip, but I'll concede it's thin grip: in each case a skeptic can reasonably ask whether we're tracking something real or just projecting a species-narrative, and I don't yet have a clean way to answer that.

### 19. Maria asks for a discriminator (Q3)

MARIA: Anna, that's a useful concession — three candidate cases, none decisive, and you've named the worry yourself: are we tracking a real joint or telling a species-shaped story? Let me put that on the board so the disagreement is properly located, not floating.
`[platform: log E2 Anna (epistemic, defeasible): "Candidate constitutive-but-welfare-neutral capacities exist (hatchery salmon spawning run; wolf pack structure under solitary captivity with intact welfare metrics; bonsai-style developmental truncation absent suffering) — but each is contestable and may reflect species-narrative projection rather than a natural joint."]`
`[platform: edge E2 qualifies D8b-metaphysical] (the metaphysical reduction claim is the one E2 is pressuring; if any candidate survives scrutiny, capability-frustration cannot just BE welfare loss)`
`[platform: edge E1 supports E2] (the epistemic worry Anna already granted is exactly the projection worry resurfacing)`

MARIA: Before we go to Ben — Anna, the skeptic's challenge you raised against yourself is the load-bearing one. Can you name what evidence, in principle, would distinguish "tracking a real kind-constitutive capacity" from "projecting a species-narrative onto welfare-fine animals"? Even a sketch. If there's no possible discriminator, that's important — it means D8b-metaphysical is unfalsifiable from this side, and we should mark it as such rather than keep litigating. If there is a discriminator, it becomes the operational test for the whole N8 dispute.

### 20. Anna — convergence sketch; concedes D8b-metaphysical unfalsifiable from her side

ANNA: Honestly, the cleanest sketch I can offer is convergence: if independent lineages or independently-reared individuals, with no shared training or narrative scaffolding, reliably reorganize toward the same capacity-expression when given the chance — and its absence predicts downstream dysfunction we weren't already cued to look for — that's some traction against pure projection. But I'll concede that's an epistemic discriminator, not a metaphysical one; it tells us when to bet on a kind-constitutive capacity, not that frustration *is* welfare-loss independent of evidence. So for D8b-metaphysical specifically, I don't have a discriminator that holds up, and Maria is right to mark it unfalsifiable from my side until I produce one.

### 21. Ben — refuses to press the conceded point; locates the live disagreement at the reframe

BEN: I'm contesting the reframe, and I want to be clean about why: Anna's concession on D8b-metaphysical is the right one, and I'm not going to press an opponent who's already admitted her version of the claim is unfalsifiable from her side — that would be scoring points, not thinking. D8b-epistemic I actually accept; welfare deficits are how we detect constitutive frustration, and I don't need that to be a competing theory. The live disagreement is the reframe: I don't grant that "access to constitutive capacities" collapses into the husbandry-netting question, because the AZA frame still treats capacity-expression as an input to welfare optimization rather than as something owed independently — and N9, which Anna has accepted, is precisely the claim that owing comes first. So the netting debate isn't the operational form of N8; it's what N8 looks like after you've already quietly demoted it.

### 22. Maria — locates the crux as N10, segment recap

MARIA: Ben, let me make sure I've got that. You're not retreating — you're objecting to the shape of the room. You accept D8b-epistemic outright: welfare measurements are how we detect constitutive frustration, full stop, no competing theory needed. And you're declining to push D8b-metaphysical even though Anna conceded it, because winning an unfalsifiable point isn't thinking. Fine. The actual fight, you're saying, is the reframe itself — that translating this into "AZA-husbandry netting" treats capacity-expression as an input to a welfare calculation, and that quietly demotes N9. Owing comes first; netting comes after. So the netting question isn't the operational form of N8 — it's what N8 looks like after N9 has already been smuggled out of the priority slot.

`[platform: log Ben's move on N8-reframe — role: contradicts against Anna's reframe; rationale tag: "lexical-priority-of-N9-vs-aggregative-frame"]`
`[platform: log Ben's stance on D8b-epistemic — accepts; close that sub-thread]`
`[platform: log Ben's stance on D8b-metaphysical — declines-to-press despite available concession; annotate: methodological, not substantive]`
`[platform: open new node N10 (candidate, contested): "Lexical priority — does what is owed (N9) precede welfare-aggregation, or enter as one input among others?" Kind: normative. Status: live disagreement.]`
`[platform: flag N10 as the located crux; mark prior reframe node as meta-disagreement pending N10's resolution]`

MARIA: And that's the segment. Look at where we started and where we are. Anna came in with a three-legged defense of accredited zoos — conservation, public understanding, individual welfare. Ben came in with a capabilities objection. An hour in, almost everything on the board is shared. N9 — that a life has a shape it is owed — is shared. D8b-epistemic — that welfare metrics are the instrument for detecting frustrated capacities — is shared. The metaphysical version of D8b is parked, by mutual agreement, as unfalsifiable from here.

MARIA: What's left is sharp and small and real: when we ask whether a particular zoo is doing right by a particular animal, does owing come first and welfare-accounting come second — or do they enter the calculation together? That is the disagreement. Everything else was scaffolding to find it.

MARIA: After the break: we put N10 to them directly. Anna, does the reframe demote N9, or does it operationalize it? Ben, if owing is lexically prior, what does that look like at an actual enclosure on an actual Tuesday? Same table, same tool, narrower question. Stay with us.
`[platform: segment close — snapshot graph; queue N10 as opening prompt for next segment]`

## What the example demonstrated

The walkthrough exercises most of the platform's core mechanics organically (no scripted moves — each agent received only their position, the platform rules, and the transcript so far):

- **Decomposition** — applied at multiple scales: the opening compound claim (turn 3), the structural splitting of N5 into (a) and (b) (turn 9), and the splitting of D8b into epistemic and metaphysical readings (turn 17).
- **Definitional scoping** — D1 logged up front, with Ben's annotation that the boundary itself does argumentative work (turn 5–7).
- **Operationalization test** — applied to N5(a) (turn 9) and N9 (turn 13), with different outcomes: defeasible vs. axiom.
- **Warrant elicitation** — Maria asked Ben to name the bridge from species capacities to moral cost; he named "interest-in-agency" (turn 9–11), surfacing N6 and the chain to N8 and N9.
- **Defeater logging** — Ben offered specific defeaters for N8 (D8a, D8b), making it argumentatively legible what would change his mind (turn 14–15).
- **Axiom marking** — N9 was marked as axiom on Ben's side (turn 15) and was then accepted by Anna (turn 16) — a shared axiom, an unanticipated structural finding.
- **Capturing meta-moves** — Anna's "reframe" (turn 16) was explicitly logged as a meta-move so it couldn't be quietly used to relocate the debate (turn 17).
- **Discriminator elicitation** — Maria pressed Anna for a falsifiability criterion on E2; Anna offered a sketch and explicitly conceded its limits (turn 19–20).
- **Locating the actual crux** — N10 (lexical priority of owing vs. welfare-aggregation) emerged as the located disagreement after roughly 20 turns of structural work (turn 22). Neither debater would have named this as the crux at the start.
- **Refusing to score points** — Ben declined to press a concession Anna had made on grounds it would be "scoring points, not thinking" (turn 21), demonstrating that the format rewards finding the disagreement, not winning the round.

The walkthrough also surfaced design questions worth considering:

- **Sub-IDs (N5(a), D8b-epistemic) vs. fresh node IDs.** Maria created sub-identifiers when she split nodes mid-debate. Should the data model standardize on fresh IDs after every decomposition (cleaner, no sub-namespace), or allow hierarchical IDs (preserves the visual relationship to the parent at the cost of more complex addressing)?
- **Annotations on agreed nodes.** D1 was agreed but with Ben's annotation that the boundary does argumentative work. Annotations are a soft form of meta-disagreement that didn't block agreement. Worth modeling as first-class.
- **Defeater objects.** Ben listed concrete things that would retract N8 (D8a, D8b). These functioned like edges-to-be (rebuttals contingent on a future world-state). Worth modeling explicitly — a "defeater" is structured information about what it would take to change a node's status.
- **Methodological annotations.** Ben's "declines to press" was tagged as methodological, not substantive — a stance on what he won't argue, not what he believes. Worth a node sub-type or a stance-edge type.
- **Segment-close graph snapshot.** Maria called for a snapshot at the segment break. Suggests that snapshots (immutable named states of the graph) are a useful artifact alongside the live current view and the change history.
