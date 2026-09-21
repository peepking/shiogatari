# 潮語り 釣り対象マスター候補一覧

釣りシステム用の釣果マスター候補。種類数の上限は設けず、メジャーな魚介、巨大魚、珍魚、深海生物、古代魚まで幅広く採用する。
季節・海/浅瀬・餌・出現重み・サイズ・価格はまだ確定しない。

## 件数（原典200種＋追加決定分）

| 区分 | 原典 | 追加 | 合計 |
| --- | ---: | ---: | ---: |
| 魚類（サメ・エイを含む） | 160 | 54 | 214 |
| イカ | 10 | 2 | 12 |
| タコ | 10 | 3 | 13 |
| エビ・シャコ | 10 | 5 | 15 |
| カニ | 10 | 6 | 16 |
| 古代魚 | 0 | 5 | 5 |
| **総数** | **200** | **86** | **286** |

> 実装側の `FISH_SPECIES` 配列は 286 種を定義しています。
> `feedType` の分布: `cut` 219 種、`shell` 33 種、`small` 34 種。
> `insect` に該当する魚介類はありません。

この文書では、以下の原典200種のID・名称・順序を保持したまま、後段の「追加決定分」を別IDで積み増す。追加一覧との重複は検査済み。

## 海域イメージ

  ID     海域   現実世界のイメージ
  ------ ------ ------------------------
  `nw`   北西   日本海
  `ne`   北東   北海道近海
  `sw`   南西   九州・四国地方近海
  `se`   南東   東京湾など関東・太平洋

選定は日本近海の海水魚・頭足類・甲殻類を中心としつつ、世界の有名な海洋生物や古代の海洋魚類もレア枠として採用する。純淡水魚は採用しない（海水域で生活する回遊魚・汽水域にも入る種は可）。
地域割り当ては次工程で行い、4海域すべてに固有の狙い目ができるよう調整する。

## 餌タイプ（feedType）について

実装側（`fishingConfig.js` の `FISH_SPECIES`）では、各魚種に `feedType` を定義し、魚を餌に加工した際の変換先を決めています。

| feedType | 表示名 | 対象となる主な魚介類 |
|---------|--------|---------------------|
| `shell` | 甲殻類 | エビ・カニ・シャコ類 |
| `cut`   | 魚肉団子 | イカ・タコ・ウミヘビ・大型魚・深海魚・古代魚 など |
| `small` | 小魚   | イワシ・アジ・サンマ・キス・メバル・ベラ・ギンポ・ハゼ類 など小型魚 |

- `insect`（虫餌）に該当する魚介類はありません。
- 実装上の分布: `cut` 219 種、`shell` 33 種、`small` 34 種（計 286 種）。
- 魚種マスターの各エントリに `feedType` フィールドを持たせています。

## 魚 160種

      \# id                     名前                  feedType
      ----- ---------------------- -------------------- ----------
      1 `aji`                  マアジ
      2 `muroaji`              ムロアジ
      3 `shimaaji`             シマアジ
      4 `meaji`                メアジ
      5 `maiwashi`             マイワシ
      6 `urumeiwashi`          ウルメイワシ
      7 `katakuchiiwashi`      カタクチイワシ
      8 `masaba`               マサバ
      9 `gomasaba`             ゴマサバ
     10 `sawara`               サワラ
     11 `buri`                 ブリ
     12 `kanpachi`             カンパチ
     13 `hiramasa`             ヒラマサ
     14 `shiira`               シイラ
     15 `katsuo`               カツオ
     16 `sumagatsuo`           スマ
     17 `hagatsuo`             ハガツオ
     18 `koshinagamaguro`      コシナガ
     19 `kuromaguro`           クロマグロ
     20 `kihadamaguro`         キハダ
     21 `mebachimaguro`        メバチ
     22 `binchomaguro`         ビンナガ
     23 `madai`                マダイ
     24 `chidai`               チダイ
     25 `kidai`                キダイ
     26 `kurodai`              クロダイ
     27 `kichinu`              キチヌ
     28 `hedai`                ヘダイ
     29 `ishidai`              イシダイ
     30 `ishigakidai`          イシガキダイ
     31 `mejina`               メジナ
     32 `kuro-mejina`          クロメジナ
     33 `isaki`                イサキ
     34 `fuefukidai`           フエフキダイ
     35 `hamafuefuki`          ハマフエフキ
     36 `yokosuji-fuedai`      ヨコスジフエダイ
     37 `hamadai`              ハマダイ
     38 `aodai`                アオダイ
     39 `hime-dai`             ヒメダイ
     40 `akamutsu`             アカムツ
     41 `kuromutsu`            クロムツ
     42 `mutsu`                ムツ
     43 `kinmedai`             キンメダイ
     44 `nanyoukinme`          ナンヨウキンメ
     45 `madara`               マダラ
     46 `suketoudara`          スケトウダラ
     47 `komai`                コマイ
     48 `hatahata`             ハタハタ
     49 `hokke`                ホッケ
     50 `kijihata`             キジハタ
     51 `akahata`              アカハタ
     52 `oo-mon-hata`          オオモンハタ
     53 `mahata`               マハタ
     54 `kue`                  クエ
     55 `yamabuki-hata`        ヤマブキハタ
     56 `nominokuchi`          ノミノクチ
     57 `ainame`               アイナメ
     58 `kuezo-ainame`         クエゾアイナメ
     59 `uso-ainame`           ウサギアイナメ
     60 `takenoko-mebaru`      タケノコメバル
     61 `kurosoi`              クロソイ
     62 `ezomebaru`            エゾメバル
     63 `shiro-mebaru`         シロメバル
     64 `aka-mebaru`           アカメバル
     65 `kasa-go`              カサゴ
     66 `yume-kasago`          ユメカサゴ
     67 `onikasago`            オニカサゴ
     68 `kitsune-mebaru`       キツネメバル
     69 `yanagi-no-mai`        ヤナギノマイ
     70 `hirame`               ヒラメ
     71 `makogarei`            マコガレイ
     72 `ishigarei`            イシガレイ
     73 `meitagarei`           メイタガレイ
     74 `musigarei`            ムシガレイ
     75 `yanagimushigarei`     ヤナギムシガレイ
     76 `akagarei`             アカガレイ
     77 `souhachi`             ソウハチ
     78 `kuro-gashira-garei`   クロガシラガレイ
     79 `matsukawa`            マツカワ
     80 `hoshigarei`           ホシガレイ
     81 `shirogisu`            シロギス
     82 `aogisu`               アオギス
     83 `ishimochi`            シログチ
     84 `nibe`                 ニベ
     85 `oo-nibe`              オオニベ
     86 `koichi`               コイチ
     87 `suzuki`               スズキ
     88 `hirasuzuki`           ヒラスズキ
     89 `tai-riku-suzuki`      タイリクスズキ
     90 `bora`                 ボラ
     91 `menada`               メナダ
     92 `konoshiro`            コノシロ
     93 `sayori`               サヨリ
     94 `tobiuo`               トビウオ
     95 `hoshi-zame`           ホシザメ
     96 `nekosame`             ネコザメ
     97 `shumokuzame`          シュモクザメ
     98 `aozame`               アオザメ
     99 `yoshikirizame`        ヨシキリザメ
    100 `akaei`                アカエイ
    101 `hoshiei`              ホシエイ
    102 `tsubakuroei`          ツバクロエイ
    103 `tachiuo`              タチウオ
    104 `kamasu`               アカカマス
    105 `yamato-kamasu`        ヤマトカマス
    106 `anago`                マアナゴ
    107 `hamo`                 ハモ
    108 `utsubo`               ウツボ
    109 `torautsubo`           トラウツボ
    110 `dai-nan-umihebi`      ダイナンウミヘビ
    111 `eso`                  マエソ
    112 `wana-eso`             ワニエソ
    113 `houbou`               ホウボウ
    114 `kanagashira`          カナガシラ
    115 `kochi`                マゴチ
    116 `megochi`              ネズミゴチ
    117 `oniokoze`             オニオコゼ
    118 `aigo`                 アイゴ
    119 `nizadai`              ニザダイ
    120 `tenguhagi`            テングハギ
    121 `kawahagi`             カワハギ
    122 `uma-zura-hagi`        ウマヅラハギ
    123 `uso-kawahagi`         ウスバハギ
    124 `harisenbon`           ハリセンボン
    125 `kusafugu`             クサフグ
    126 `shousaifugu`          ショウサイフグ
    127 `torafugu`             トラフグ
    128 `gomafugu`             ゴマフグ
    129 `ma-fugu`              マフグ
    130 `bera`                 キュウセン
    131 `sasanohabera`         ササノハベラ
    132 `kobudai`              コブダイ
    133 `budai`                ブダイ
    134 `takanoha-dai`         タカノハダイ
    135 `migi-maki`            ミギマキ
    136 `ishimochi2`           テンジクダイ
    137 `nenbutsu-dai`         ネンブツダイ
    138 `suzume-dai`           スズメダイ
    139 `oyabitcha`            オヤビッチャ
    140 `niji-ginpo`           ニジギンポ
    141 `gimpo`                ギンポ
    142 `anahaze`              アナハゼ
    143 `kegani-kajika`        ケムシカジカ
    144 `aburabouzu`           アブラボウズ
    145 `ibodai`               イボダイ
    146 `medai`                メダイ
    147 `managatsuo`           マナガツオ
    148 `e-bodai`              エボダイ
    149 `gin-dara`             ギンダラ
    150 `ginzame`              ギンザメ
    151 `ryugu-no-tsukai`      リュウグウノツカイ
    152 `aka-yagara`           アカヤガラ
    153 `ao-yagara`            アオヤガラ
    154 `herayagara`           ヘラヤガラ
    155 `matsudai`             マツダイ
    156 `ishinagi`             オオクチイシナギ
    157 `ko-ishinagi`          コクチイシナギ
    158 `higedai`              ヒゲダイ
    159 `korodai`              コロダイ
    160 `maruaji`              マルアジ

## イカ 10種

    \# id             名前                  feedType
    ---- -------------- -------------- ----------
     1 `aoriika`      アオリイカ
     2 `yariika`      ヤリイカ
     3 `surumeika`    スルメイカ
     4 `kensakiika`   ケンサキイカ
     5 `kouika`       コウイカ
     6 `mongouika`    カミナリイカ
     7 `hotaruika`    ホタルイカ
     8 `sodeika`      ソデイカ
     9 `mimiika`      ミミイカ
    10 `himekouika`   ヒメコウイカ

## タコ 10種

    \# id                    名前                  feedType
    ---- --------------------- -------------------- ----------
     1 `madako`              マダコ
     2 `mizudako`            ミズダコ
     3 `iidako`              イイダコ
     4 `yanagidako`          ヤナギダコ
     5 `te-naga-dako`        テナガダコ
     6 `wamon-dako`          ワモンダコ
     7 `shimachou-dako`      シマダコ
     8 `sunadako`            スナダコ
     9 `chichuukai-madako`   チチュウカイマダコ
    10 `hyoumon-dako`        ヒョウモンダコ

## エビ 10種

    \# id                 名前                  feedType
    ---- ------------------ -------------- ----------
     1 `kurumaebi`        クルマエビ
     2 `kumaebi`          クマエビ
     3 `yoshiebi`         ヨシエビ
     4 `shibaebi`         シバエビ
     5 `botanebi`         ボタンエビ
     6 `hokkokuakaebi`    ホッコクアカエビ
     7 `toyamaebi`        トヤマエビ
     8 `ibara-moki-ebi`   イバラモエビ
     9 `iseebi`           イセエビ
    10 `zuwai?`           セミエビ

## カニ 10種

    \# id                  名前                  feedType
    ---- ------------------- ---------------- ----------
     1 `gazami`            ガザミ
     2 `taiwan-gazami`     タイワンガザミ
     3 `kegani`            ケガニ
     4 `zuwai-gani`        ズワイガニ
     5 `beni-zuwai-gani`   ベニズワイガニ
     6 `takaashi-gani`     タカアシガニ
     7 `ishigani`          イシガニ
     8 `hiratsume-gani`    ヒラツメガニ
     9 `asahi-gani`        アサヒガニ
    10 `mokuzu-gani`       モクズガニ

## 追加決定分（75種）

以下は原典200種に含まれないものだけを追加する。通常の地域魚に加え、世界の巨大種・深海の珍魚・古代魚は低確率のレア枠に置く。

### 魚類（54種）

    \# id                       名前                  feedType
    ---- ------------------------ -------------------- ----------
     1 `sanma`                  サンマ
     2 `nishin`                 ニシン
     3 `sake`                   サケ（海洋回遊個体）
     4 `karafutomasu`          カラフトマス（海洋回遊個体）
     5 `ohyou`                  オヒョウ
     6 `ankou`                  アンコウ
     7 `kiankou`                キアンコウ
     8 `chouchin-ankou`         チョウチンアンコウ
     9 `manbou`                 マンボウ
    10 `ushimanbou`             ウシマンボウ
    11 `yarimanbou`             ヤリマンボウ
    12 `goushiumanbou`          ゴウシュウマンボウ
    13 `mekajiki`               メカジキ
    14 `makajiki`               マカジキ
    15 `kurokajiki`             クロカジキ
    16 `shirokajiki`            シロカジキ
    17 `bashoukajiki`           バショウカジキ
    18 `tobiei`                 トビエイ
    19 `nokogiriei`             ノコギリエイ
    20 `denkiei`                デンキエイ
    21 `manta`                  マンタ（オニイトマキエイ）
    22 `tatsunootoshigo`        タツノオトシゴ
    23 `dangouo`                ダンゴウオ
    24 `hoteiuo`                ホテイウオ
    25 `ikanago`                イカナゴ
    26 `amadai`                 アマダイ
    27 `itoyoridai`             イトヨリダイ
    28 `akoudai`                アコウダイ
    29 `ara`                    アラ
    30 `ookamiuo`               オオカミウオ
    31 `rabuka`                 ラブカ
    32 `mitsukurizame`          ミツクリザメ
    33 `onagazame`              オナガザメ
    34 `ubazame`                ウバザメ
    35 `hohojirozame`           ホホジロザメ
    36 `ondenzame`              オンデンザメ
    37 `jinbeizame`             ジンベエザメ
    38 `sakegashira`            サケガシラ
    39 `furisodeuo`             フリソデウオ
    40 `tengaibata`             テンガイハタ
    41 `mizu-uo`                ミズウオ
    42 `baramutsu`              バラムツ
    43 `akamanbou`              アカマンボウ
    44 `coelacanth`             シーラカンス
    45 `ronin-aji`              ロウニンアジ
    46 `sugi`                   スギ
    47 `tarpon`                 ターポン
    48 `snook`                  スヌーク
    49 `roosterfish`            ルースターフィッシュ
    50 `megamouth-zame`         メガマウスザメ
    51 `itachizame`             イタチザメ
    52 `oomejirozame`           オオメジロザメ
    53 `ootenjikuzame`          オオテンジクザメ
    54 `madaratobiei`           マダラトビエイ

### イカ（2種）

    \# id                       名前                  feedType
    ---- ------------------------ -------------------- ----------
     1 `daiouika`               ダイオウイカ
     2 `daiouhouzukiika`        ダイオウホウズキイカ

### タコ（3種）

    \# id                       名前                  feedType
    ---- ------------------------ -------------------- ----------
     1 `kantendako`             カンテンダコ
     2 `mendako`                メンダコ
     3 `oodako`                 オオダコ

### エビ・シャコ（5種）

    \# id                       名前                  feedType
    ---- ------------------------ -------------------- ----------
     1 `nishikiebi`             ニシキエビ
     2 `goshikiebi`             ゴシキエビ
     3 `zouriebi`               ゾウリエビ
     4 `akazaebi`               アカザエビ
     5 `monhanashako`           モンハナシャコ

### カニ（6種）

    \# id                       名前                  feedType
    ---- ------------------------ -------------------- ----------
     1 `tarabagani`             タラバガニ
     2 `hanasakigani`           ハナサキガニ
     3 `nokogirigazami`         ノコギリガザミ
     4 `tasmaniaoogani`         タスマニアオオガニ
     5 `yashigani`              ヤシガニ
     6 `oozuwaigani`            オオズワイガニ

### 古代魚（5種）

    \# id                       名前                  feedType
    ---- ------------------------ -------------------- ----------
     1 `dunkleosteus`           ダンクルオステウス
     2 `leed-sichthys`          リードシクティス
     3 `xiphactinus`            シファクティヌス
     4 `helicoprion`            ヘリコプリオン
     5 `megalodon`              メガロドン

## 次工程

各種に `regions`、`seasons`、`depth`、`baits`
を割り当てる。古代魚は通常種とは別の極低確率レア枠として扱う想定。
その後 `sizeRange`、`sellPrice`、`dressFood`、`baseWindow` を調整する。

> 注:
> この段階ではゲーム用候補リスト。実際の漁法として一般的に竿釣りしないエビ・カニ等も、
> 潮語りの「釣り対象」として扱う前提。
