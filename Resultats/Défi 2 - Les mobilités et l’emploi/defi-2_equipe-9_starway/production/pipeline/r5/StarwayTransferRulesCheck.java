import com.conveyal.r5.profile.FastRaptorWorker;
import com.conveyal.r5.profile.RaptorState;
import com.conveyal.r5.profile.StarwayTransferRules;

/**
 * Controle du correctif D-031 (pipeline/r5/r5-d031-transfer-rules.patch) contre le jar compile, sans reseau.
 * Regle de R5 : un depart d est accepte si d > earliestBoardTime (FastRaptorWorker, McRAPTOR : d > t + slack).
 * Attendu : regle d'origine (> 60 s) sans duree chargee, sans arrivee en TC a l'arret, ou au tour 0 (acces) ;
 * apres une arrivee en TC a un arret de duree D : depart accepte si d >= arrivee + D, jamais plus permissif.
 * Usage (VM) : javac -cp <jar> -d out StarwayTransferRulesCheck.java && java -cp <jar>:out StarwayTransferRulesCheck
 */
public class StarwayTransferRulesCheck {
    private static int failures = 0;

    private static void expect (String label, long got, long want) {
        boolean ok = got == want;
        if (!ok) failures++;
        System.out.println((ok ? "OK   " : "ECHEC ") + label + " : " + got + (ok ? "" : " (attendu " + want + ")"));
    }

    /** Premier depart accepte (seconde entiere) apres `earliest` selon la regle stricte de R5. */
    private static int firstAccepted (int earliest) {
        return earliest + 1;
    }

    public static void main (String[] args) {
        expect("version du correctif", StarwayTransferRules.STARWAY_TRANSFER_RULES_VERSION, 1);
        RaptorState round0 = new RaptorState(4, 7200);
        RaptorState round1 = new RaptorState(4, 7200);
        round1.previous = round0;
        int a = 36000; // arrivee a 10:00:00
        // arret 1 : arrivee en TC ; arret 2 : arrivee en TC puis meilleure heure par une marche depuis un autre arret
        round1.bestTimes[1] = a;
        round1.bestNonTransferTimes[1] = a;
        round1.bestTimes[2] = a - 30;
        round1.bestNonTransferTimes[2] = a;
        // arret 3 : acces a pied (tour 0)
        round0.bestTimes[3] = a;

        StarwayTransferRules.setSameStopMinSeconds(null);
        expect("sans duree : premier depart accepte - arrivee", firstAccepted(
            StarwayTransferRules.earliestBoardTime(round1, 1, 60)) - a, 61);
        expect("sans duree : arrets charges", StarwayTransferRules.loadedStopCount(), 0);

        StarwayTransferRules.setSameStopMinSeconds(new int[] {0, 300, 300, 300});
        expect("arrets charges", StarwayTransferRules.loadedStopCount(), 3);
        expect("arrivee en TC, 300 s : premier depart accepte - arrivee", firstAccepted(
            StarwayTransferRules.earliestBoardTime(round1, 1, 60)) - a, 300);
        expect("marche depuis un autre arret : regle d'origine", firstAccepted(
            StarwayTransferRules.earliestBoardTime(round1, 2, 60)) - (a - 30), 61);
        expect("acces (tour 0) : regle d'origine", firstAccepted(
            StarwayTransferRules.earliestBoardTime(round0, 3, 60)) - a, 61);
        round1.bestTimes[0] = a;
        round1.bestNonTransferTimes[0] = a;
        expect("arrivee en TC, arret sans duree (0) : regle d'origine", firstAccepted(
            StarwayTransferRules.earliestBoardTime(round1, 0, 60)) - a, 61);
        expect("constante UNREACHED inchangee", FastRaptorWorker.UNREACHED, Integer.MAX_VALUE);
        // McRAPTOR : depart > t + boardSlack(arret, arrivee en TC ?, BOARD_SLACK)
        expect("McRAPTOR, arrivee en TC, 300 s", StarwayTransferRules.boardSlack(1, true, 60) + 1, 300);
        expect("McRAPTOR, etat de correspondance ou d'acces", StarwayTransferRules.boardSlack(1, false, 60) + 1, 61);
        StarwayTransferRules.setSameStopMinSeconds(new int[] {30, 120});
        expect("duree plus courte que la regle d'origine", StarwayTransferRules.boardSlack(0, true, 60) + 1, 61);
        expect("120 s", StarwayTransferRules.boardSlack(1, true, 60) + 1, 120);
        expect("index hors tableau", StarwayTransferRules.boardSlack(9, true, 60) + 1, 61);
        StarwayTransferRules.setSameStopMinSeconds(null);
        System.out.println(failures == 0 ? "TOUT OK" : failures + " ECHEC(S)");
        System.exit(failures == 0 ? 0 : 1);
    }
}
