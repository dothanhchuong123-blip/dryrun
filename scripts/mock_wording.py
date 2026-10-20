"""Scripted wording and example-specific setup for scripts/make_mock_stream.py.

Only words live here (headlines, agent text, shopper bubbles) plus the choice of futures and plans.
Every number in the finished mock comes from the real engine when make_mock_stream.py runs.
"""
# ruff: noqa: C408
from __future__ import annotations

# The US example first (the demo), then the Ho Chi Minh City alternative, then the rest.
EXAMPLE_ORDER = ["coffee_austin", "coffee_hcmc", "pc_parts", "furniture_eu"]
MOCKED = ["coffee_austin", "coffee_hcmc"]  # examples the offline demo can play

_PLANS = [
    ("seed", 0, dict(name="Stock up 4 weeks", extra_stock_weeks=4, stock_week=0)),
    ("seed", 0, dict(name="Raise price 4% from week 2", price_change_pct=4, price_change_week=2)),
    ("seed", 0, dict(name="Backup supplier", switch_supplier=True, alt_cost_change_pct=8, alt_lead_time_weeks=2,
                     alt_shock_exposure=0.3)),
    ("ai", 1, dict(name="Stock up 6 weeks", extra_stock_weeks=6, stock_week=0)),
    ("ai", 1, dict(name="Stock 3 wk + raise 3% wk 3", extra_stock_weeks=3, stock_week=0, price_change_pct=3,
                   price_change_week=3)),
    ("ai", 2, dict(name="Stock 4 wk + raise 3% wk 3", extra_stock_weeks=4, stock_week=0, price_change_pct=3,
                   price_change_week=3)),
    ("ai", 2, dict(name="Raise 3% + more marketing", price_change_pct=3, price_change_week=3,
                   marketing_change_pct=20)),
]

# ---------------------------------------------------------------------------------------------
# coffee_austin: the US demo
# ---------------------------------------------------------------------------------------------
# bubbles[archetype id] = (plan raises price, plan is about stock/supply, anything else)
_AUSTIN_BUBBLES = {
    1: ("A bit more per bag? I'll grab whatever's on sale.",
        "Fine, as long as the bag is on the shelf and the price holds.",
        "Still my bag, but I'm watching for coupons."),
    2: ("Capital City is cheaper. I'm done paying more.",
        "Nice that they have stock, but price still decides it for me.",
        "I check both shelves every time. Capital City is still my pick."),
    3: ("A little more hurts on a pension, but I know this bag.",
        "Good to hear it won't run out. I like the familiar one.",
        "I'll keep buying the same bag I always have."),
    4: ("Prices are up everywhere. I'll stay with Capital City for now.",
        "Reliable supply is what I pay for. Staying put.",
        "Capital City works for us. No reason to change."),
    5: ("I'll compare shelf prices first. If the gap grows, I'm out.",
        "Good that they planned ahead. I'll keep buying while the price is fair.",
        "I like Lone Star, but I always compare deals."),
    6: ("Price history says Capital City is cheaper now. Switching.",
        "Stocked is nice, but I buy on price.",
        "Close enough that I'll stay, but I'm tracking it."),
    7: ("Everything costs more lately. I'll stay if the bag is always there.",
        "Never finding the shelf empty is what I care about. Staying.",
        "Same bag, same shelf. No complaints."),
    8: ("I read about the tariffs. A small rise seems fair.",
        "Good news on supply. That keeps me coming back.",
        "I buy the same bag out of habit."),
    9: ("I'll pay a bit more for this roast, but not a lot more.",
        "Smart to plan ahead. Still the best beans around.",
        "Still my roaster. I love a clever deal when I find one."),
    10: ("Capital City is cheaper this week. I'll wait for a dip.",
         "Stock is fine, but I'll still wait for a deal.",
         "Loyal to Capital City, but I enjoy catching a sale."),
    11: ("I barely notice it. I just want the same fresh roast.",
         "Exactly what I want: always fresh, never out.",
         "Quality and availability are all I care about."),
    12: ("Capital City has earned my trust. A rival's rise doesn't change that.",
         "Their supply planning is a plus, but I'm staying with Capital City.",
         "Capital City's service and reliability keep me."),
}

_AUSTIN = dict(
    business_name=None,
    input_word="Beans",
    input_noun="green beans",
    unit="bag",
    bubbles=_AUSTIN_BUBBLES,
    shocks=[
        dict(id="news", label="Beans +30% (today's news)", delta_c_raw=0.30, delta_lead_time=1, onset_week=2,
             ramp_weeks=3, likelihood="likely",
             why="The new tariff on Brazilian coffee is passing straight into green-bean prices",
             source_ids=["n1"], origin="news"),
        dict(id="s1", label="Beans +45%, shipping +2 wk", delta_c_raw=0.45, delta_lead_time=2, onset_week=2,
             ramp_weeks=4, likelihood="possible",
             why="If the tariff widens and Gulf ports stay congested, costs and delays could both get worse",
             source_ids=["n1", "n2"], origin="ai"),
        dict(id="s2", label="Beans +30%, Capital City cuts 5%", delta_c_raw=0.30, delta_lead_time=1, onset_week=2,
             ramp_weeks=3, rival_price_change_pct=-5, likelihood="possible",
             why="Capital City is bigger and may defend its café and grocery accounts", source_ids=["n1", "m2"],
             origin="ai"),
        dict(id="s3", label="Chain takes 8% of accounts", delta_c_raw=0.30, delta_lead_time=1, onset_week=2,
             ramp_weeks=3, share_shift_pct=8, likelihood="possible",
             why="Today's tariff news, plus a regional chain that roasts its own taking cafés and shelf space",
             source_ids=["m1"], origin="ai"),
        dict(id="s4", label="Beans ease back −12%", delta_c_raw=-0.12, delta_lead_time=0, onset_week=3,
             ramp_weeks=3, likelihood="unlikely", why="A tariff exemption or a bigger Brazilian crop could bring prices down",
             source_ids=["n2"], origin="ai"),
    ],
    plans=_PLANS,
    news=[
        dict(id="n1", kind="supply",
             title="New tariff pushes green coffee import costs up as US roasters absorb the hit",
             url="https://example.com/news/coffee-tariff-roasters", source="Coffee Market Wire",
             published="2026-10-17",
             quote="green coffee from Brazil now costs importers about 30% more after the tariff took effect",
             shock=dict(delta_c_raw=0.30, delta_lead_time=1, demand_shock=0.0),
             cost_line=None, impact_usd=None, impact_p5_usd=None, live=False, applied=True),
        dict(id="n2", kind="supply",
             title="Port congestion on the Gulf Coast adds a week to coffee deliveries",
             url="https://example.com/news/gulf-port-delays", source="Specialty Coffee Brief",
             published="2026-10-14",
             quote="importers say beans could climb another 25% if the delays and the tariff both stay",
             shock=dict(delta_c_raw=0.25, delta_lead_time=0, demand_shock=0.0),
             cost_line=None, impact_usd=None, impact_p5_usd=None, live=False, applied=False),
        dict(id="m1", kind="market", title="Regional coffee chain plans 25 new Texas locations next year",
             url="https://example.com/news/texas-chain-expansion", source="Austin Business Ledger",
             published="2026-10-15",
             quote="the chain roasts in-house and plans to price below local specialty brands", shock=None,
             cost_line=None, impact_usd=None, impact_p5_usd=None, live=False, applied=False),
        dict(id="m2", kind="market", title="Capital City Coffee says it will hold wholesale prices through the holidays",
             url="https://example.com/news/capital-city-holds", source="Texas Grocer Weekly",
             published="2026-10-13",
             quote="we will not pass the whole increase on to our grocery and café customers", shock=None,
             cost_line=None, impact_usd=None, impact_p5_usd=None, live=False, applied=False),
    ],
    script=dict(
        mode_reason="Offline demo: the recorded Austin coffee example is playing.",
        scenario_thought=(
            "Beans +30% is the news column. Two bigger worries for a small Austin roaster: the tariff could widen "
            "and Gulf port delays could push beans to +45% with slower shipping, and Capital City has said it "
            "will hold its prices, so a 5% cut is realistic. A regional chain with 25 new locations could pull 8% "
            "of your accounts. One column for a price fall, marked unlikely."),
        scenario_reasoning=[
            "news n1: Brazil tariff, green coffee +30%. your beans = 60% of cost → cost +18%\n",
            "7.80 × 0.60 × 0.30 = $1.40 a bag. margin 13.00 − 7.80 = $5.20 → 5.20 − 1.40 = $3.80\n",
            "n2: Gulf port delays, +1 wk transit → could extend the spike. try +45%, shipping +2 wk\n",
            "m2: Capital City 'will not pass it all on' → rival price −5% is plausible\n",
            "m1: 25-location chain, own roasting → share shift ~8% of accounts from wk 4\n",
            "also one downside column: beans −12%, unlikely but plans must not rely on a spike\n",
        ],
        unmodelled=[
            dict(text="A possible Texas sales-tax change on packaged coffee is being discussed", source_id="m2"),
            dict(text="Larger grocers may ask for longer payment terms when prices rise", source_id=None),
        ],
        round_reasoning={
            "1": [
                "seed results: stock 4 wk covers the spike but ties up a lot of cash\n",
                "price +4% alone: little cash, fine in the news column, loses if beans fall back\n",
                "try: stock 3 wk + raise 3% wk 3 → less cash, keeps the volume\n",
                "try: stock 6 wk → big gain but cash > $12,000 → will show 'Over your cash'\n",
            ],
            "2": [
                "best so far: stock 3 wk + raise 3% wk 3. more stock helps while cash allows\n",
                "stock 4 wk fits the $12,000 → combine with +3% wk 3\n",
                "marketing +20% costs money now and brings little back → test it once\n",
            ],
        },
        rounds=[
            dict(round=0,
                 think="Starting with three simple plans: buy more stock, raise the price, or switch supplier.",
                 test="Testing 3 starter plans against {n_shocks} futures, 1,000 runs per cell.",
                 shoppers="Asked the shopper groups how each starter plan feels to them.",
                 result_for=["Stock up 4 weeks", "Raise price 4% from week 2"]),
            dict(round=1,
                 think="Stock helps but cash is tight. Trying a smaller stock-up with a price rise, and a bigger one.",
                 test="Testing 2 new plans against all futures.",
                 shoppers="Shoppers: price-hunters switch to Capital City faster than loyal buyers.",
                 result_for=["Stock 3 wk + raise 3% wk 3", "Stock up 6 weeks"]),
            dict(round=2,
                 think="Combining what worked: 4 weeks of stock fits your cash, plus a small rise. One marketing test.",
                 test="Testing the last 2 plans.",
                 shoppers="Shoppers: a small rise after a stock-up reads as fair when everyone's costs jump.",
                 result_for=["Stock 4 wk + raise 3% wk 3"]),
        ],
        over_cash_plan="Stock up 6 weeks",
        memo_headlines={"Stock 4 wk + raise 3% wk 3": "Stock up 4 weeks now and raise your price 3% in week 3"},
        memo_headline_default="Follow the plan below",
        news_phrase="the tariff keeps green beans 30% dearer",
        fall_phrase="beans fall back",
        rival_phrase="Capital City cuts 5%",
        recheck_when="Beans move more than 10% either way, or Capital City changes its price.",
        not_modelled_fixed=[
            "Fixed costs such as rent and salaries (profit here is gross profit)",
            "Taxes",
            "Payment terms: we assume you pay suppliers when you order and customers pay when they buy",
            "Seasonality",
            "Your other products",
            "Warehouse space limits",
            "How other rivals react (we model one main rival)",
        ],
        news_check=dict(
            title="Importers report Brazilian coffee stocks at a three-year low in US warehouses",
            url="https://example.com/news/live-coffee-stocks", source="Coffee Market Wire",
            published="2026-10-19",
            quote="US warehouse stocks of Brazilian coffee are the lowest in three years heading into the holidays",
            shock=dict(delta_c_raw=0.12, delta_lead_time=0, demand_shock=0),
            cost_line="Beans +12% × 60% of your cost is green beans = your cost +7% (+$0.56 a bag)"),
    ),
)

# ---------------------------------------------------------------------------------------------
# coffee_hcmc: the Ho Chi Minh City alternative
# ---------------------------------------------------------------------------------------------
_HCMC_COMBOS = {
    ("hunter", "A"): ("Highland is cheaper, I'm tempted to move.",
                      "Good that you plan ahead, but I still compare prices.",
                      "I like your roast, though I always check the other price."),
    ("hunter", "B"): ("Highland is already cheaper. Why pay more?",
                      "Stock is nice, price still wins for me.",
                      "Highland is my default unless you beat the price."),
    ("moderate", "A"): ("A small rise is fine, I know your roast.",
                        "Never running out is what I care about.",
                        "Same roaster, same beans. I'm happy."),
    ("moderate", "B"): ("The gap to Highland is growing, but I'm still with them.",
                        "Reliable supply is a plus, but I'm staying with Highland.",
                        "Highland works for my café. I won't change."),
}
_HCMC_BUBBLES = {
    a: _HCMC_COMBOS[(s, l)]
    for a, (s, l) in {
        1: ("hunter", "A"), 2: ("hunter", "B"), 3: ("moderate", "A"), 4: ("moderate", "B"),
        5: ("hunter", "A"), 6: ("hunter", "B"), 7: ("moderate", "A"), 8: ("moderate", "B"),
        9: ("hunter", "A"), 10: ("hunter", "B"), 11: ("moderate", "A"), 12: ("moderate", "B"),
    }.items()
}

_HCMC = dict(
    business_name="Saigon Roasters",
    input_word="Beans",
    input_noun="beans",
    unit="bag",
    bubbles=_HCMC_BUBBLES,
    shocks=[
        dict(id="news", label="Beans +31% (today's news)", delta_c_raw=0.31, delta_lead_time=1, onset_week=2,
             ramp_weeks=3, likelihood="likely", why="Robusta futures hit a record and exporters are holding back stock",
             source_ids=["n1"], origin="news"),
        dict(id="s1", label="Beans +45%, shipping +2 wk", delta_c_raw=0.45, delta_lead_time=2, onset_week=2,
             ramp_weeks=4, likelihood="possible", why="If the dry spell in the Highlands lasts, prices could keep climbing",
             source_ids=["n1", "n2"], origin="ai"),
        dict(id="s2", label="Beans +31%, Highland cuts 5%", delta_c_raw=0.31, delta_lead_time=1, onset_week=2,
             ramp_weeks=3, rival_price_change_pct=-5, likelihood="possible",
             why="Highland is bigger and may defend its cafés", source_ids=["n1", "m1"], origin="ai"),
        dict(id="s3", label="New chain takes 8% of cafés", delta_c_raw=0.31, delta_lead_time=1, onset_week=2,
             ramp_weeks=3, share_shift_pct=8, likelihood="possible",
             why="Today's beans news, plus a chain that roasts its own taking cafés", source_ids=["m1"], origin="ai"),
        dict(id="s4", label="Beans ease back −12%", delta_c_raw=-0.12, delta_lead_time=0, onset_week=3,
             ramp_weeks=3, likelihood="unlikely", why="A good harvest could pull prices down again",
             source_ids=["n2"], origin="ai"),
    ],
    plans=_PLANS,
    news=[
        dict(id="n1", kind="supply", title="Robusta prices hit a record high as Vietnamese exporters hold back stock",
             url="https://example.com/news/robusta-record", source="Reuters", published="2026-10-12",
             quote="robusta futures rose 31% in four weeks to a record as exporters held back supply",
             shock=dict(delta_c_raw=0.31, delta_lead_time=1, demand_shock=0.0), cost_line=None,
             impact_usd=None, impact_p5_usd=None, live=False, applied=True),
        dict(id="n2", kind="supply", title="Dry spell in the Central Highlands threatens the next harvest",
             url="https://example.com/news/highlands-dry", source="VnExpress", published="2026-10-09",
             quote="traders expect beans to climb another 25% if the dry spell holds",
             shock=dict(delta_c_raw=0.25, delta_lead_time=0, demand_shock=0.0),
             cost_line=None, impact_usd=None, impact_p5_usd=None, live=False, applied=False),
        dict(id="m1", kind="market", title="New café chain plans 40 outlets in Ho Chi Minh City by next year",
             url="https://example.com/news/new-chain", source="Tuoi Tre", published="2026-10-10",
             quote="the chain will roast its own beans and sell below established brands", shock=None,
             cost_line=None, impact_usd=None, impact_p5_usd=None, live=False, applied=False),
        dict(id="m2", kind="market", title="Highland Supply says it will protect its café accounts this quarter",
             url="https://example.com/news/highland", source="Saigon Times", published="2026-10-08",
             quote="we will not pass the whole increase on to our cafés", shock=None, cost_line=None,
             impact_usd=None, impact_p5_usd=None, live=False, applied=False),
    ],
    script=dict(
        mode_reason="Offline demo: the recorded Ho Chi Minh City coffee example is playing.",
        scenario_thought=(
            "Beans +31% is the news column. Two bigger worries for a small roaster: the dry spell could push beans "
            "to +45% with slower shipping, and Highland has said it will protect its cafés, so a 5% price cut is "
            "realistic. A new chain with 40 outlets could pull 8% of cafés. One column for a bean price fall, "
            "marked unlikely."),
        scenario_reasoning=[
            "news n1: robusta +31% in 4 wk. your beans = 85% of cost → cost +26%\n",
            "6.50 × 0.85 × 0.31 = $1.71 a bag. margin 11.00 − 6.50 = $4.50 → 4.50 − 1.71 = $2.79\n",
            "n2: dry spell, harvest −10% → could extend the spike. try +45%, shipping +2 wk\n",
            "m2: Highland 'will not pass it all on' → rival price −5% is plausible\n",
            "m1: 40-outlet chain, own roasting → share shift ~8% of cafés from wk 4\n",
            "also one downside column: beans −12%, unlikely but plans must not rely on a spike\n",
        ],
        unmodelled=[
            dict(text="A new tax on imported coffee equipment is being discussed", source_id="m2"),
            dict(text="Your larger cafés may ask for credit terms when prices rise", source_id=None),
        ],
        round_reasoning={
            "1": [
                "seed results: stock 4 wk covers the spike but is tied to cash ($7.3k of $8,000)\n",
                "price +4% alone: little cash, good in news column, loses in 'beans −12%'\n",
                "try: stock 3 wk + raise 3% wk 3 → less cash, keeps the volume\n",
                "try: stock 6 wk → big gain but cash > $8,000 → will show 'Over your cash'\n",
            ],
            "2": [
                "best so far: stock 3 wk + raise 3% wk 3. more stock helps while cash allows\n",
                "stock 4 wk fits the $8,000 (peak cash $7.3k) → combine with +3% wk 3\n",
                "marketing +20% costs money now and brings little back → test it once\n",
            ],
        },
        rounds=[
            dict(round=0,
                 think="Starting with three simple plans: buy more stock, raise the price, or switch supplier.",
                 test="Testing 3 starter plans against {n_shocks} futures, 1,000 runs per cell.",
                 shoppers="Asked the shopper groups how each starter plan feels to them.",
                 result_for=["Stock up 4 weeks", "Raise price 4% from week 2"]),
            dict(round=1,
                 think="Stock helps but cash is tight. Trying a smaller stock-up with a price rise, and a bigger one.",
                 test="Testing 2 new plans against all futures.",
                 shoppers="Shoppers: price-hunting cafés dislike a rise more than loyal regulars.",
                 result_for=["Stock 3 wk + raise 3% wk 3", "Stock up 6 weeks"]),
            dict(round=2,
                 think="Combining what worked: 4 weeks of stock fits your cash, plus a small rise. One marketing test.",
                 test="Testing the last 2 plans.",
                 shoppers="Shoppers: a small rise after a stock-up reads as fair when everyone's costs jump.",
                 result_for=["Stock 4 wk + raise 3% wk 3"]),
        ],
        over_cash_plan="Stock up 6 weeks",
        memo_headlines={"Stock 4 wk + raise 3% wk 3": "Stock up 4 weeks now and raise your price 3% in week 3"},
        memo_headline_default="Follow the plan below",
        news_phrase="beans keep their +31% jump",
        fall_phrase="beans fall back",
        rival_phrase="Highland cuts 5%",
        recheck_when="Beans move more than 10% either way, or Highland changes its price.",
        not_modelled_fixed=[
            "Fixed costs such as rent and salaries (profit here is gross profit)",
            "Taxes",
            "Payment terms: we assume you pay suppliers when you order and customers pay when they buy",
            "Seasonality",
            "Your other products",
            "Warehouse space limits",
            "How other rivals react (we model one main rival)",
        ],
        news_check=dict(
            title="Vietnamese exporters report robusta stocks at a three-year low",
            url="https://example.com/news/live-robusta-stocks", source="Nikkei Asia", published="2026-10-15",
            quote="exporters' robusta stocks are the lowest in three years heading into the new crop",
            shock=dict(delta_c_raw=0.12, delta_lead_time=0, demand_shock=0),
            cost_line="Beans +12% × 85% of your cost is beans = your cost +10% (+$0.66 a bag)"),
    ),
)

CONFIGS = {"coffee_austin": _AUSTIN, "coffee_hcmc": _HCMC}
