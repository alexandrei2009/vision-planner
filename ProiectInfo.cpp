#include <iostream>
#include <fstream>
#include <cstring>
using namespace std;
struct eveniment
{
    char nume[101];
    int zi, luna, an;
    int nrParticipanti;
    double sumaBani;
    eveniment *urm;
};

eveniment *creeazaEveniment(char nume[], int zi, int luna, int an,int nrParticipanti, double sumaBani)
{
    eveniment *nou = new eveniment;
    strcpy(nou->nume, nume);
    nou->zi = zi;
    nou->luna = luna;
    nou->an = an;
    nou->nrParticipanti = nrParticipanti;
    nou->sumaBani = sumaBani;
    nou->urm = NULL;
    return nou;
}

int comparaDate(int zi1, int luna1, int an1, int zi2, int luna2, int an2)
{
    if (an1 < an2)
        return -1;
    if (an1 > an2)
        return 1;

    if (luna1 < luna2)
        return -1;
    if (luna1 > luna2)
        return 1;

    if (zi1 < zi2)
        return -1;
    if (zi1 > zi2)
        return 1;

    return 0;
}

int vineInainteCalendaristic(eveniment *a, eveniment *b)
{
    int comparatie = comparaDate(a->zi, a->luna, a->an, b->zi, b->luna, b->an);

    if (comparatie < 0)
        return 1;
    return 0;
}

void afiseazaUnEveniment(eveniment *p, ofstream &fout)
{
    fout << p->nume << " - " << p->zi << "." << p->luna << "." << p->an<< ", participanti: " << p->nrParticipanti<< ", suma: " << p->sumaBani << "\n";
}

void adaugaEvenimentLaFinal(eveniment *&prim, char nume[], int zi, int luna, int an,int nrParticipanti, double sumaBani)
{
    eveniment *nou = creeazaEveniment(nume, zi, luna, an, nrParticipanti, sumaBani);

    if (prim == NULL)
    {
        prim = nou;
        return;
    }

    eveniment *p = prim;
    while (p->urm != NULL)
        p = p->urm;

    p->urm = nou;
}

void insereazaNodCalendaristic(eveniment *&prim, eveniment *nou)
{
    if (nou == NULL)
        return;

    if (prim == NULL || vineInainteCalendaristic(nou, prim))
    {
        nou->urm = prim;
        prim = nou;
        return;
    }

    insereazaNodCalendaristic(prim->urm, nou);
}

void adaugaEvenimentOrdonat(eveniment *&prim, char nume[], int zi, int luna, int an, int nrParticipanti, double sumaBani)
{
    eveniment *nou = creeazaEveniment(nume, zi, luna, an, nrParticipanti, sumaBani);
    insereazaNodCalendaristic(prim, nou);
}

void ordoneazaCalendaristicRecursiv(eveniment *&prim)
{
    if (prim == NULL || prim->urm == NULL)
        return;

    eveniment *primul = prim;
    prim = prim->urm;
    primul->urm = NULL;

    ordoneazaCalendaristicRecursiv(prim);
    insereazaNodCalendaristic(prim, primul);
}

eveniment *cautaEvenimentRecursiv(eveniment *p, char nume[])
{
    if (p == NULL)
        return NULL;

    if (strcmp(p->nume, nume) == 0)
        return p;

    return cautaEvenimentRecursiv(p->urm, nume);
}

eveniment *scoateNodDupaNume(eveniment *&prim, char nume[])
{
    if (prim == NULL)
        return NULL;

    if (strcmp(prim->nume, nume) == 0)
    {
        eveniment *gasit = prim;
        prim = prim->urm;
        gasit->urm = NULL;
        return gasit;
    }

    eveniment *anterior = prim;
    eveniment *p = prim->urm;

    while (p != NULL && strcmp(p->nume, nume) != 0)
    {
        anterior = p;
        p = p->urm;
    }

    if (p == NULL)
        return NULL;

    anterior->urm = p->urm;
    p->urm = NULL;
    return p;
}

int stergeEveniment(eveniment *&prim, char nume[])
{
    eveniment *gasit = scoateNodDupaNume(prim, nume);

    if (gasit == NULL)
        return 0;

    delete gasit;
    return 1;
}

void afiseazaListaRecursiv(eveniment *p, ofstream &fout)
{
    if (p == NULL)
        return;

    afiseazaUnEveniment(p, fout);
    afiseazaListaRecursiv(p->urm, fout);
}

void afiseazaEvenimenteDinLunaRecursiv(eveniment *p, int luna,ofstream &fout, int &gasit)
{
    if (p == NULL)
        return;

    if (p->luna == luna)
    {
        gasit = 1;
        afiseazaUnEveniment(p, fout);
    }

    afiseazaEvenimenteDinLunaRecursiv(p->urm, luna, fout, gasit);
}

int modificaNrParticipanti(eveniment *prim, char nume[], int nrNou)
{
    eveniment *gasit = cautaEvenimentRecursiv(prim, nume);

    if (gasit == NULL)
        return 0;

    gasit->nrParticipanti = nrNou;
    return 1;
}

int modificaSumaBani(eveniment *prim, char nume[], double sumaNoua)
{
    eveniment *gasit = cautaEvenimentRecursiv(prim, nume);

    if (gasit == NULL)
        return 0;

    gasit->sumaBani = sumaNoua;
    return 1;
}

int modificaData(eveniment *&prim, char nume[], int ziNoua, int lunaNoua, int anNou)
{
    eveniment *gasit = scoateNodDupaNume(prim, nume);

    if (gasit == NULL)
        return 0;

    gasit->zi = ziNoua;
    gasit->luna = lunaNoua;
    gasit->an = anNou;
    gasit->urm = NULL;

    insereazaNodCalendaristic(prim, gasit);
    return 1;
}

int modificaInformatii(eveniment *&prim, char numeVechi[], char numeNou[], int ziNoua, int lunaNoua, int anNou,int nrNou, double sumaNoua)
{
    eveniment *gasit = scoateNodDupaNume(prim, numeVechi);

    if (gasit == NULL)
        return 0;

    strcpy(gasit->nume, numeNou);
    gasit->zi = ziNoua;
    gasit->luna = lunaNoua;
    gasit->an = anNou;
    gasit->nrParticipanti = nrNou;
    gasit->sumaBani = sumaNoua;
    gasit->urm = NULL;

    insereazaNodCalendaristic(prim, gasit);
    return 1;
}

double sumaTotalaRecursiv(eveniment *p)
{
    if (p == NULL)
        return 0;

    return p->sumaBani + sumaTotalaRecursiv(p->urm);
}

double sumaLunaRecursiv(eveniment *p, int luna)
{
    if (p == NULL)
        return 0;

    if (p->luna == luna)
        return p->sumaBani + sumaLunaRecursiv(p->urm, luna);

    return sumaLunaRecursiv(p->urm, luna);
}

eveniment *copiazaListaRecursiv(eveniment *p)
{
    if (p == NULL)
        return NULL;

    eveniment *copie = creeazaEveniment(p->nume, p->zi, p->luna, p->an,p->nrParticipanti, p->sumaBani);
    copie->urm = copiazaListaRecursiv(p->urm);
    return copie;
}

int vineInainteDupaParticipanti(eveniment *a, eveniment *b)
{
    if (a->nrParticipanti < b->nrParticipanti)
        return 1;
    if (a->nrParticipanti > b->nrParticipanti)
        return 0;

    return vineInainteCalendaristic(a, b);
}

void insereazaNodDupaParticipantiRecursiv(eveniment *&prim, eveniment *nou)
{
    if (nou == NULL)
        return;

    if (prim == NULL || vineInainteDupaParticipanti(nou, prim))
    {
        nou->urm = prim;
        prim = nou;
        return;
    }

    insereazaNodDupaParticipantiRecursiv(prim->urm, nou);
}

void ordoneazaDupaParticipantiRecursiv(eveniment *&prim)
{
    if (prim == NULL || prim->urm == NULL)
        return;

    eveniment *primul = prim;
    prim = prim->urm;
    primul->urm = NULL;

    ordoneazaDupaParticipantiRecursiv(prim);
    insereazaNodDupaParticipantiRecursiv(prim, primul);
}

int numaraEvenimenteRecursiv(eveniment *p)
{
    if (p == NULL)
        return 0;

    return 1 + numaraEvenimenteRecursiv(p->urm);
}

void salveazaListaInInput(eveniment *prim)
{
    ofstream foutInput("input.txt");

    foutInput << numaraEvenimenteRecursiv(prim) << "\n";

    while (prim != NULL)
    {
        foutInput << prim->nume << " " << prim->zi << " " << prim->luna << " " << prim->an << " " << prim->nrParticipanti << " "<< prim->sumaBani << "\n";
        prim = prim->urm;
    }

    foutInput << 0 << "\n";
    foutInput.close();
}

void stergeToataLista(eveniment *&prim)
{
    while (prim != NULL)
    {
        eveniment *p = prim;
        prim = prim->urm;
        delete p;
    }
}

void afiseazaAjutor(ofstream &fout)
{
    fout << "Comenzi disponibile:\n";
    fout << "ADAUGA nume zi luna an nrParticipanti suma\n";
    fout << "ADAUGA_ORDONAT nume zi luna an nrParticipanti suma\n";
    fout << "ADAUGA_FINAL nume zi luna an nrParticipanti suma\n";
    fout << "STERGE nume\n";
    fout << "CAUTA nume\n";
    fout << "AFISEAZA_CALENDAR\n";
    fout << "AFISEAZA_LUNA luna\n";
    fout << "MODIFICA_PARTICIPANTI nume nrNou\n";
    fout << "MODIFICA_DATA nume ziNoua lunaNoua anNou\n";
    fout << "ORDONEAZA_PERSOANE\n";
    fout << "MODIFICA_SUMA nume sumaNoua\n";
    fout << "SUMA_TOTALA\n";
    fout << "SUMA_LUNA luna\n";
    fout << "MODIFICA_INFO numeVechi numeNou zi luna an nrParticipanti suma\n";
}

void proceseazaComanda(eveniment *&prim, char comanda[], ifstream &fin, ofstream &fout)
{
    if (strcmp(comanda, "AJUTOR") == 0)
    {
        afiseazaAjutor(fout);
    }
    else if (strcmp(comanda, "ADAUGA") == 0 || strcmp(comanda, "ADAUGA_ORDONAT") == 0)
    {
        char nume[101];
        int zi, luna, an, nrParticipanti;
        double sumaBani;

        fin >> nume >> zi >> luna >> an >> nrParticipanti >> sumaBani;
        adaugaEvenimentOrdonat(prim, nume, zi, luna, an, nrParticipanti, sumaBani);
        fout << "Evenimentul " << nume << " a fost adaugat calendaristic.\n";
    }
    else if (strcmp(comanda, "ADAUGA_FINAL") == 0)
    {
        char nume[101];
        int zi, luna, an, nrParticipanti;
        double sumaBani;

        fin >> nume >> zi >> luna >> an >> nrParticipanti >> sumaBani;
        adaugaEvenimentLaFinal(prim, nume, zi, luna, an, nrParticipanti, sumaBani);
        fout << "Evenimentul " << nume << " a fost adaugat la final.\n";
    }
    else if (strcmp(comanda, "STERGE") == 0)
    {
        char nume[101];
        fin >> nume;

        if (stergeEveniment(prim, nume))
            fout << "Evenimentul " << nume << " a fost sters.\n";
        else
            fout << "Nu exista.\n";
    }
    else if (strcmp(comanda, "CAUTA") == 0)
    {
        char nume[101];
        fin >> nume;

        eveniment *gasit = cautaEvenimentRecursiv(prim, nume);

        if (gasit == NULL)
            fout << "Nu exista.\n";
        else
        {
            fout << "Eveniment gasit: " << gasit->nume << " - " << gasit->zi << "." << gasit->luna << "." << gasit->an << ", participanti: " << gasit->nrParticipanti << "\n";
        }
    }
    else if (strcmp(comanda, "AFISEAZA_CALENDAR") == 0 || strcmp(comanda, "AFISEAZA") == 0)
    {
        ordoneazaCalendaristicRecursiv(prim);

        if (prim == NULL)
            fout << "Nu exista evenimente.\n";
        else
            afiseazaListaRecursiv(prim, fout);
    }
    else if (strcmp(comanda, "AFISEAZA_LUNA") == 0)
    {
        int luna, gasit = 0;
        fin >> luna;

        afiseazaEvenimenteDinLunaRecursiv(prim, luna, fout, gasit);

        if (gasit == 0)
            fout << "Nu exista evenimente in luna " << luna << ".\n";
    }
    else if (strcmp(comanda, "MODIFICA_PARTICIPANTI") == 0)
    {
        char nume[101];
        int nrNou;
        fin >> nume >> nrNou;

        if (modificaNrParticipanti(prim, nume, nrNou))
            fout << "Numarul de participanti pentru " << nume << " a fost modificat.\n";
        else
            fout << "Nu exista.\n";
    }
    else if (strcmp(comanda, "MODIFICA_DATA") == 0)
    {
        char nume[101];
        int ziNoua, lunaNoua, anNou;
        fin >> nume >> ziNoua >> lunaNoua >> anNou;

        if (modificaData(prim, nume, ziNoua, lunaNoua, anNou))
            fout << "Data pentru " << nume << " a fost modificata.\n";
        else
            fout << "Nu exista.\n";
    }
    else if (strcmp(comanda, "ORDONEAZA_PERSOANE") == 0)
    {
        eveniment *copie = copiazaListaRecursiv(prim);
        ordoneazaDupaParticipantiRecursiv(copie);

        if (copie == NULL)
            fout << "Nu exista evenimente.\n";
        else
            afiseazaListaRecursiv(copie, fout);

        stergeToataLista(copie);
    }
    else if (strcmp(comanda, "MODIFICA_SUMA") == 0)
    {
        char nume[101];
        double sumaNoua;
        fin >> nume >> sumaNoua;

        if (modificaSumaBani(prim, nume, sumaNoua))
            fout << "Suma pentru " << nume << " a fost modificata.\n";
        else
            fout << "Nu exista.\n";
    }
    else if (strcmp(comanda, "SUMA_TOTALA") == 0)
    {
        fout << "Suma totala este: " << sumaTotalaRecursiv(prim) << "\n";
    }
    else if (strcmp(comanda, "SUMA_LUNA") == 0)
    {
        int luna;
        fin >> luna;

        fout << "Suma pentru luna " << luna << " este: "
             << sumaLunaRecursiv(prim, luna) << "\n";
    }
    else if (strcmp(comanda, "MODIFICA_INFO") == 0)
    {
        char numeVechi[101], numeNou[101];
        int ziNoua, lunaNoua, anNou, nrNou;
        double sumaNoua;

        fin >> numeVechi >> numeNou >> ziNoua >> lunaNoua >> anNou >> nrNou >> sumaNoua;

        if (modificaInformatii(prim, numeVechi, numeNou, ziNoua, lunaNoua, anNou, nrNou, sumaNoua))
            fout << "Informatiile pentru " << numeVechi << " au fost modificate.\n";
        else
            fout << "Nu exista.\n";
    }
    else
    {
        fout << "Comanda necunoscuta: " << comanda << "\n";
    }
}

int main()
{
    ifstream fin("input.txt");
    ofstream fout("output.txt");

    eveniment *prim = NULL;
    int n, i;

    if (!fin)
    {
        fout << "Nu se poate deschide fisierul input.txt.\n";
        return 0;
    }

    if (!(fin >> n))
    {
        fout << "Fisierul de intrare nu contine numarul de evenimente.\n";
        return 0;
    }

    for (i = 1; i <= n; i++)
    {
        char nume[101];
        int zi, luna, an, nrParticipanti;
        double sumaBani;

        if (fin >> nume >> zi >> luna >> an >> nrParticipanti >> sumaBani)
            adaugaEvenimentOrdonat(prim, nume, zi, luna, an, nrParticipanti, sumaBani);
        else
        {
            fout << "Nu s-au putut citi toate evenimentele.\n";
            break;
        }
    }

    int nrComenzi = 0;
    if (!(fin >> nrComenzi))
        nrComenzi = 0;

    for (i = 1; i <= nrComenzi; i++)
    {
        char comanda[51];
        fin >> comanda;

        fout << "\n[" << i << "] " << comanda << "\n";
        proceseazaComanda(prim, comanda, fin, fout);
    }

    ordoneazaCalendaristicRecursiv(prim);

    fin.close();
    fout.close();

    salveazaListaInInput(prim);
    stergeToataLista(prim);

    return 0;
}
