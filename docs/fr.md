# Google Cast

Pilotez vos appareils Google Cast depuis Gladys : Chromecast, enceintes et
écrans Google Nest (Nest Mini, Nest Audio, Nest Hub...), téléviseurs avec
Chromecast intégré ou Google TV, et les groupes d'enceintes de l'application
Google Home.

Tout se passe sur votre **réseau local** : ni compte Google, ni cloud, ni clé
d'API. Cette intégration remplace l'intégration Google Cast intégrée à Gladys,
avec bien plus que les annonces.

## Où elle fonctionne

- **Pays** : partout. Google Cast est un protocole local, sans service
  régional derrière : l'intégration fonctionne dans tous les pays et toutes
  les régions où les appareils Cast sont vendus, quelle que soit la langue de
  l'appareil.
- **Réseau** : Gladys et les appareils Cast doivent partager le même réseau
  local. La découverte utilise le mDNS (comme votre téléphone), qui ne
  traverse pas les routeurs : un appareil sur un autre VLAN ou sous-réseau
  peut tout de même être ajouté par son adresse IP (voir _Adresses
  manuelles_), tant que Gladys peut le joindre sur le port TCP 8009 (et
  32000-33000 pour les groupes d'enceintes).
- **Depuis l'extérieur** : les appareils Cast ne sont joignables que depuis
  votre réseau, mais Gladys l'est aussi — le tableau de bord, les scènes et
  Gladys Plus fonctionnent de partout, Gladys relaie les commandes en local.

Nécessite Gladys Assistant **5.3.0 ou plus récent**.

## Ce que vous obtenez

Chaque appareil Cast devient un lecteur de musique dans Gladys, avec :

- la **carte « lecture en cours »** du tableau de bord : titre, artiste,
  album, pochette, progression, lecture / pause / précédent / suivant, quelle
  que soit l'application qui diffuse (Spotify, YouTube Music, Deezer, une
  webradio...) ;
- le **volume** et la **sourdine**, synchronisés quand quelqu'un les change
  depuis un téléphone ou l'appareil lui-même ;
- les **annonces** : l'action de scène « Jouer une notification » de Gladys
  parle sur l'appareil (synthèse vocale) ;
- un badge **local** sur l'appareil, rouge quand l'appareil est injoignable.

L'intégration garde une connexion ouverte avec chaque appareil ajouté : chaque
changement est envoyé par l'appareil, rien n'est interrogé en boucle.

## Installation et configuration

1. Installez **Google Cast** depuis le catalogue des intégrations.
2. Ouvrez l'onglet **Découverte** : les appareils Cast de votre réseau sont
   listés. Ajoutez ceux que vous voulez. Les groupes d'enceintes apparaissent
   aussi.
3. C'est tout. L'onglet **Configuration** propose quelques options :
   - **Adresses manuelles** : les adresses IP des appareils que la découverte
     ne trouve pas (autre VLAN), séparées par des virgules, par exemple
     `192.168.20.15, 192.168.20.16:8009`. Fixez l'adresse de ces appareils
     dans votre box : c'est elle qui les identifie.
   - **Groupes d'enceintes** : décochez pour masquer les groupes d'enceintes.
   - **Volume des annonces** : le volume des annonces de Gladys, de 1 à
     100 % ; le volume précédent revient après l'annonce. `0` garde le volume
     actuel.
   - **Durée de la recherche** : augmentez-la s'il manque des appareils dans
     l'onglet Découverte.

Boutons de l'onglet Configuration :

- **Rechercher sur le réseau** : retrouve les appareils (les nouveaux vont
  dans l'onglet Découverte) et met à jour l'adresse des appareils connus.
- **Tester un appareil** : se connecte à l'appareil choisi et affiche son
  volume et l'application en cours.

Un appareil dont l'adresse a changé (nouveau bail DHCP) est retrouvé
automatiquement après quelques échecs de connexion.

## Scènes

### Déclencheurs

Dans l'éditeur de scènes, dans la catégorie de l'intégration :

- **Lecture Cast démarrée** : une lecture commence ou reprend, ou le morceau
  change. Variables : `title`, `artist`, `app`.
- **Lecture Cast arrêtée** : le média s'est terminé, a été arrêté,
  interrompu ou a échoué. Filtrez sur la raison si besoin. Variables :
  `reason` (`finished`, `cancelled`, `interrupted`, `error`), `title`.
- **Application Cast lancée** : une application commence à diffuser
  (YouTube, Netflix, Spotify...). Filtrez sur son nom exact si besoin.
  Variables : `app`, `app_id`.
- **Appareil Cast en ligne / hors ligne** : un appareil devient joignable ou
  injoignable. Variable : `status` (`online`, `offline`).

Chaque déclencheur peut être limité à un appareil ; laissé vide, tout
appareil correspond. Les variables se lisent avec
`{{triggerEvent.data.title}}` dans les actions suivantes. Ce que
l'intégration diffuse elle-même (actions de scène, annonces) ne déclenche
jamais ces déclencheurs : une scène ne peut pas tourner en boucle.

Le volume et l'état de lecture sont aussi des fonctionnalités de l'appareil :
le déclencheur standard « État d'un appareil » fonctionne dessus (« quand la
TV est en pause... »).

### Actions

- **Diffuser un média** : lit une URL sur un appareil : une webradio, un son,
  une vidéo, une image (par exemple la capture d'une caméra). Choisissez le
  format, ou laissez l'intégration le deviner d'après l'URL ; cochez _Flux en
  direct_ pour une webradio. Sortie : `played`.
- **Jouer un son** : joue un son court (carillon, alarme) au volume choisi,
  puis remet le volume précédent. Sortie : `played`.
- **Arrêter la diffusion** : quitte l'application qui diffuse sur l'appareil.
  Sortie : `stopped` (faux si rien n'était diffusé).
- **Lancer une application Cast** : ouvre une application à partir de son
  identifiant Cast, par exemple `233637DE` (YouTube). Sortie : `launched`.

L'URL doit être accessible par l'appareil Cast lui-même (une URL publique, ou
une adresse de votre réseau local). Un appareil injoignable n'arrête pas la
scène : la sortie vaut `false`, utilisez-la dans une condition si besoin.

Les actions standard de Gladys fonctionnent aussi : **Jouer une
notification** (synthèse vocale), **Contrôler un appareil** (volume,
sourdine, état de lecture).

## Tableau de bord

- La carte **Musique** de Gladys affiche n'importe quel appareil Cast, avec sa
  pochette et ses commandes.
- Widget **Appareils Google Cast** : tous les appareils d'un coup d'œil (en
  ligne, application qui diffuse, lecture en cours).
- Widget **Lecteur Google Cast** : un appareil, son volume en direct, la
  pochette, le titre et l'artiste, et les boutons lecture / pause, suivant et
  arrêt.

## Migrer depuis l'intégration Google Cast intégrée

Les appareils de cette intégration sont de nouveaux appareils Gladys :

1. Ajoutez les appareils depuis l'onglet Découverte de cette intégration.
2. Dans vos scènes, faites pointer les actions **Jouer une notification**
   vers les nouveaux appareils, et mettez à jour vos tableaux de bord.
3. Supprimez les appareils de l'intégration intégrée (Intégrations → Google
   Cast → Appareils).

## Dépannage

- **Aucun appareil dans l'onglet Découverte** : les appareils doivent être
  sur le même réseau que Gladys. Vérifiez qu'ils apparaissent dans
  l'application Google Home sur le même Wi-Fi, augmentez la durée de
  recherche, ou utilisez les adresses manuelles.
- **Badge injoignable** : l'appareil est éteint, ou son adresse a changé.
  Utilisez **Rechercher sur le réseau**, puis **Tester un appareil**.
- **Pas de son pour les annonces** : l'appareil Cast télécharge le message
  vocal auprès de Gladys : il doit pouvoir joindre l'adresse de Gladys sur
  votre réseau.
- **Rien ne se passe sur suivant / précédent** : certaines applications
  (YouTube, Netflix) n'acceptent pas ces commandes venant d'un autre
  émetteur.

Logs : Intégrations → Google Cast → Logs. Passez la variable
d'environnement `LOG_LEVEL` à `debug` pour tout le détail.

## Vie privée et sécurité

L'intégration ne parle qu'aux appareils Cast de votre réseau local (connexion
chiffrée TLS, port 8009) et, pour les pochettes du tableau de bord, aux
serveurs d'images des applications qui diffusent. Aucune autre donnée ne
quitte votre domicile. Voir
[SECURITY.md](https://github.com/gboulvin/Gladys-Google-Cast/blob/main/SECURITY.md)
pour signaler une vulnérabilité.
